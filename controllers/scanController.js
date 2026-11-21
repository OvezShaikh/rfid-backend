const db = require('../config/db');
const historyController = require('./historyController');

const STRICT_CORE = false; // true = refuse to form a set if Pallet, Sleeve or Lid is missing

// ── 1. DISPATCH SCAN (Moving from Plant to Customer) ──
exports.dispatchScan = async (req, res) => {
    const { set_id, scanned_rfid_tags, vehicle_type = 'Motorcycle', destination_location_id = 5 } = req.body;

    if (!scanned_rfid_tags || scanned_rfid_tags.length === 0) {
        return res.status(400).json({ error: 'No tags scanned' });
    }

    try {
        const uniqueTags = [...new Set(scanned_rfid_tags)];
        const [components] = await db.query('SELECT * FROM components WHERE rfid_tag_id IN (?)', [uniqueTags]);

        if (components.length !== uniqueTags.length) {
            return res.status(400).json({ success: false, message: 'One or more scanned tags are not registered.' });
        }

        const [existingSets] = await db.query('SELECT * FROM containers WHERE set_id = ?', [set_id]);
        let isNewSet = false;
        let originLocationId = 1; // Default to Plant A if new

        if (existingSets.length === 0) {
            // ── AUTO-CREATE SET AT GATE ──
            isNewSet = true;
            const typesScanned = components.map(c => c.type);
            const hasCoreParts = ['Pallet', 'Sleeve', 'Lid'].every(t => typesScanned.includes(t));

            if (!hasCoreParts) {
                return res.status(400).json({ success: false, message: 'Cannot auto-create set. Scan must include at least 1 Pallet, 1 Sleeve, and 1 Lid.' });
            }

            const unavailable = components.filter(c => c.status !== 'available');
            if (unavailable.length > 0) {
                return res.status(400).json({ success: false, message: `Some components are already in use: ${unavailable.map(c => c.asset_id).join(', ')}` });
            }

            // Create container directly at the DESTINATION location
            await db.query(
                'INSERT INTO containers (set_id, vehicle_type, status, current_location_id, dispatch_time) VALUES (?, ?, "dispatched", ?, NOW())',
                [set_id, vehicle_type, destination_location_id]
            );

            // Link components and move them to DESTINATION
            const assetIds = components.map(c => c.asset_id);
            await db.query(
                'UPDATE components SET set_id = ?, status = "in_use", current_location_id = ? WHERE asset_id IN (?)',
                [set_id, destination_location_id, assetIds]
            );

        } else {
            // ── EXISTING SET VALIDATION ──
            const existingSet = existingSets[0];
            originLocationId = existingSet.current_location_id; // Log where it was dispatched FROM

            const invalidComponents = components.filter(c => c.set_id !== set_id);
            if (invalidComponents.length > 0) {
                return res.status(400).json({ success: false, message: `Wrong parts scanned: ${invalidComponents.map(c => c.asset_id).join(', ')}` });
            }

            if (existingSet.status === 'dispatched') {
                return res.status(400).json({ success: false, message: `Set ${set_id} is already dispatched.` });
            }

            // Update container to DESTINATION
            await db.query(
                'UPDATE containers SET status = "dispatched", dispatch_time = NOW(), current_location_id = ? WHERE set_id = ?', 
                [destination_location_id, set_id]
            );
            
            // Move components to DESTINATION
            await db.query(
                'UPDATE components SET current_location_id = ? WHERE set_id = ?', 
                [destination_location_id, set_id]
            );
        }

        // ── LOG HISTORY WITH LOCATION TRACKING ──
        for (const comp of components) {
            await historyController.logHistory('DISPATCHED', comp.asset_id, { 
                set_id,
                moved_from_location_id: originLocationId,
                location_id: destination_location_id,
                note: isNewSet ? 'Auto-assembled at dispatch gate' : 'Standard dispatch'
            });
        }

        res.json({ 
            success: true, 
            message: `${components.length} components matched. ${isNewSet ? 'Set auto-assembled and dispatched' : 'Dispatch confirmed'}.` 
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// ── 2. RECEIVE SCAN (Customer receives the set) ──
exports.receiveScan = async (req, res) => {
    const { set_id, scanned_rfid_tags } = req.body;
    
    try {
        const [sets] = await db.query('SELECT * FROM containers WHERE set_id = ?', [set_id]);
        if (sets.length === 0) return res.status(404).json({ error: 'Set not found' });
        
        const set = sets[0];
        if (set.status !== 'dispatched') {
            return res.status(400).json({ error: `Cannot receive. Set status is currently: ${set.status}` });
        }

        // Update to received
        await db.query('UPDATE containers SET status = "received", received_at = NOW() WHERE set_id = ?', [set_id]);
        
        // Log history
        const [components] = await db.query('SELECT asset_id FROM components WHERE set_id = ?', [set_id]);
        for (const comp of components) {
            await historyController.logHistory('RECEIVED', comp.asset_id, { 
                set_id,
                location_id: set.current_location_id // It stays at the customer location
            });
        }

        res.json({ success: true, message: `Set ${set_id} successfully received by customer.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ── 3. RETURN SCAN (Empty set returns to Hub) ──
exports.returnScan = async (req, res) => {
    const { set_id, scanned_rfid_tags, return_location_id = 1 } = req.body; 
    const conn = await db.getConnection();
    
    try {
        await conn.beginTransaction();

        const [sets] = await conn.query('SELECT * FROM containers WHERE set_id = ?', [set_id]);
        if (sets.length === 0) throw new Error('Set not found');
        
        const set = sets[0];
        if (set.status === 'returned' || set.status === 'assembled') {
            throw new Error(`Cannot return. Set status is currently: ${set.status}`);
        }

        const originLocationId = set.current_location_id;

        // 1. Update container status to returned
        await conn.query(
            'UPDATE containers SET status = "returned", returned_at = NOW(), current_location_id = ? WHERE set_id = ?', 
            [return_location_id, set_id]
        );
        
        // 2. THE AUTOMATION: Check if returning to Supa Warehouse (ID 1)
        if (return_location_id === 1) {
            // Auto-Disassemble: Unlink components and make them available
            await conn.query(
                'UPDATE components SET current_location_id = ?, set_id = NULL, status = "available" WHERE set_id = ?', 
                [return_location_id, set_id]
            );
            // Log Auto-Disassembly
            const [components] = await conn.query('SELECT asset_id FROM components WHERE set_id = ?', [set_id]);
            for (const comp of components) {
                await historyController.logHistory('DISASSEMBLED', comp.asset_id, { 
                    set_id: set_id,
                    location_id: return_location_id,
                    note: 'Auto-disassembled at Supa Warehouse'
                }, conn);
            }
        } else {
            // If returning to a non-warehouse location, just move them
            await conn.query('UPDATE components SET current_location_id = ? WHERE set_id = ?', [return_location_id, set_id]);
        }
        
        // Log Return history for the set itself
        const [components] = await conn.query('SELECT asset_id FROM components WHERE set_id = ?', [set_id]);
        for (const comp of components) {
            await historyController.logHistory('RETURNED', comp.asset_id, { 
                set_id,
                moved_from_location_id: originLocationId,
                location_id: return_location_id
            }, conn);
        }

        await conn.commit();
        res.json({ success: true, message: `Set ${set_id} successfully returned to hub.` });
    } catch (err) {
        await conn.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        conn.release();
    }
};

// ── UNIFIED SCAN (Handles Loose Assets, Single Sets, and Bulk Trucks) ──
exports.unifiedScan = async (req, res) => {
    const { 
        scanned_rfid_tags, 
        destination_location_id = 5, 
        vehicle_no = 'NA', 
        driver_name = 'NA',
        action = 'dispatch', // ✅ dispatch, receive, or return
        vehicle_type: forcedVehicle = null
    } = req.body;

    if (!scanned_rfid_tags || scanned_rfid_tags.length === 0) {
        return res.status(400).json({ error: 'No tags scanned' });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const uniqueTags = [...new Set(scanned_rfid_tags)];
        const [components] = await conn.query(
            'SELECT asset_id, rfid_tag_id, set_id, type, status FROM components WHERE rfid_tag_id IN (?)',
            [uniqueTags]
        );

        if (components.length === 0) throw new Error('No registered components found for the scanned tags.');

        const setIds = [...new Set(components.filter(c => c.set_id).map(c => c.set_id))];
        const looseComponents = components.filter(c => !c.set_id);

        let challanNo = null;
        let setsDispatched = [];

        // ── A. PROCESS SETS (Single or Bulk) ──
        if (setIds.length > 0) {
            // Verify sets are in the correct status based on action
            let expectedStatuses = ['assembled'];
            if (action === 'receive') expectedStatuses = ['dispatched'];
            if (action === 'return') expectedStatuses = ['dispatched', 'received'];

            const [validSets] = await conn.query(
                'SELECT set_id, vehicle_type FROM containers WHERE set_id IN (?) AND status IN (?)',
                [setIds, expectedStatuses]
            );
            
            // Move invalid sets to looseComponents if they don't match the expected status
            if (validSets.length !== setIds.length) {
                const validSetIds = validSets.map(s => s.set_id);
                const invalidComponents = components.filter(c => c.set_id && !validSetIds.includes(c.set_id));
                looseComponents.push(...invalidComponents);
                setIds.length = 0; 
                setIds.push(...validSetIds);
            }

            // If we have valid sets, process them
            if (setIds.length > 0) {
                if (action === 'receive') {
                    // ── RECEIVING A SET ──
                    await conn.query('UPDATE containers SET status = "received", received_at = NOW() WHERE set_id IN (?)', [setIds]);
                    const [setComps] = await conn.query('SELECT asset_id, set_id FROM components WHERE set_id IN (?)', [setIds]);
                    for (const comp of setComps) {
                        await historyController.logHistory('RECEIVED', comp.asset_id, { 
                            set_id: comp.set_id,
                            location_id: destination_location_id,
                            note: 'Received via Handheld'
                        }, conn);
                    }
                } else if (action === 'return') {
                    // ── RETURNING A SET ──
                    await conn.query('UPDATE containers SET status = "returned", returned_at = NOW(), current_location_id = ? WHERE set_id IN (?)', [destination_location_id, setIds]);
                    if (destination_location_id === 1) {
                        await conn.query('UPDATE components SET current_location_id = ?, set_id = NULL, status = "available" WHERE set_id IN (?)', [destination_location_id, setIds]);
                        const [allComps] = await conn.query('SELECT asset_id, set_id FROM components WHERE set_id IN (?)', [setIds]);
                        for (const comp of allComps) {
                            await historyController.logHistory('DISASSEMBLED', comp.asset_id, { set_id: comp.set_id, location_id: destination_location_id, note: 'Auto-disassembled at Warehouse' }, conn);
                        }
                    } else {
                        await conn.query('UPDATE components SET current_location_id = ? WHERE set_id IN (?)', [destination_location_id, setIds]);
                    }
                    const [setComps] = await conn.query('SELECT asset_id, set_id FROM components WHERE set_id IN (?)', [setIds]);
                    for (const comp of setComps) {
                        await historyController.logHistory('RETURNED', comp.asset_id, { set_id: comp.set_id, location_id: destination_location_id, note: 'Returned via Handheld' }, conn);
                    }
                } else {
                    // ── DISPATCHING A SET (Existing logic) ──
                    const [allDbComponents] = await conn.query('SELECT set_id, rfid_tag_id, type FROM components WHERE set_id IN (?)', [setIds]);
                    const dbCompMap = allDbComponents.reduce((acc, curr) => {
                        if (!acc[curr.set_id]) acc[curr.set_id] = [];
                        acc[curr.set_id].push(curr);
                        return acc;
                    }, {});

                    for (const setId of setIds) {
                        const expectedParts = dbCompMap[setId] || [];
                        const missingParts = expectedParts.filter(c => !uniqueTags.includes(c.rfid_tag_id));
                        if (missingParts.length > 0) {
                            const excId = 'EXC-' + Math.floor(1000 + Math.random() * 9000);
                            const missingTypes = missingParts.map(p => p.type).join(', ');
                            await conn.query('INSERT INTO exceptions (exception_id, set_id, reason) VALUES (?, ?, ?)', [excId, setId, `Gate scan incomplete. Missing: ${missingTypes}`]);
                            throw new Error(`Incomplete Set ${setId}. Missing: ${missingTypes}. Exception ${excId} generated.`);
                        }
                    }

                    challanNo = `DC-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
                    const [challanResult] = await conn.query(
                        `INSERT INTO delivery_challans (challan_no, from_location_id, to_location_id, vehicle_no, driver_name, status) VALUES (?, 2, ?, ?, ?, 'dispatched')`,
                        [challanNo, destination_location_id, vehicle_no, driver_name]
                    );
                    
                    const challanId = challanResult.insertId;
                    await conn.query('INSERT INTO challan_sets (challan_id, set_id) VALUES ?', [setIds.map(id => [challanId, id])]);
                    await conn.query('UPDATE containers SET status = "dispatched", current_location_id = ?, dispatch_time = NOW() WHERE set_id IN (?)', [destination_location_id, setIds]);
                    await conn.query('UPDATE components SET current_location_id = ? WHERE set_id IN (?)', [destination_location_id, setIds]);

                    const setComponents = components.filter(c => c.set_id && setIds.includes(c.set_id));
                    for (const comp of setComponents) {
                        await historyController.logHistory('DISPATCHED', comp.asset_id, { set_id: comp.set_id, challan_no: challanNo, location_id: destination_location_id, note: 'Dispatched with Set' }, conn);
                    }
                    setsDispatched = setIds;
                }
            }
        }

        // ── B. PROCESS LOOSE COMPONENTS (Handheld Scans) ──
        if (looseComponents.length > 0) {
            const scannedCounts = looseComponents.reduce((acc, comp) => {
                acc[comp.type] = (acc[comp.type] || 0) + 1;
                return acc;
            }, {});

            // ── FLEXIBLE ASSEMBLY: the number of INSERTS decides the vehicle ──
            // Every set has exactly 1 Pallet, 1 Sleeve, 1 Lid.
            const forcedVehicle  = req.body.vehicle_type || null; // optional: 'Motorcycle' | 'Scooter'
            const INSERTS_PER    = { Motorcycle: 2, Scooter: 3 };
            const LAYER_PADS_PER = { Motorcycle: 2, Scooter: 3 };

            const splitInserts = (n, forced) => {
                const sizes = [];
                if (forced && INSERTS_PER[forced]) {
                    const k = INSERTS_PER[forced];
                    for (let used = 0; used + k <= n; used += k) sizes.push(k);
                    return sizes;
                }
                while (n >= 2) {
                    if (n % 2 === 0) { sizes.push(2); n -= 2; }
                    else             { sizes.push(3); n -= 3; }
                }
                return sizes; // a single leftover insert stays loose
            };

            // takes up to `max` parts of a type out of looseComponents
            const take = (type, max) => {
                const got = [];
                for (let j = 0; j < looseComponents.length && got.length < max; j++) {
                    if (looseComponents[j].type === type) {
                        got.push(looseComponents[j]);
                        looseComponents.splice(j, 1);
                        j--;
                    }
                }
                return got;
            };

            if (action === 'dispatch') {
                const insertCount = looseComponents.filter(c => c.type === 'Insert').length;
                const sizes = splitInserts(insertCount, forcedVehicle);

                for (let i = 0; i < sizes.length; i++) {
                    const matchedVehicle = sizes[i] === 3 ? 'Scooter' : 'Motorcycle';
                    const prefix = matchedVehicle === 'Scooter' ? 'FLC-S' : 'FLC-M';
                    const newSetId = `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;

                    const setComponents = [
                        ...take('Insert', sizes[i]),
                        ...take('Pallet', 1),
                        ...take('Sleeve', 1),
                        ...take('Lid', 1),
                        ...take('Layer Pad', LAYER_PADS_PER[matchedVehicle]),
                    ];
                    const setAssetIds = setComponents.map(c => c.asset_id);

                    // what is missing? (tracked)
                    const have = setComponents.reduce((a, c) => { a[c.type] = (a[c.type] || 0) + 1; return a; }, {});
                    const missing = [];
                    if (!have['Pallet']) missing.push('Pallet');
                    if (!have['Sleeve']) missing.push('Sleeve');
                    if (!have['Lid'])    missing.push('Lid');
                    if (STRICT_CORE && missing.length) {
                        throw new Error(`Cannot form ${matchedVehicle} set. Missing: ${missing.join(', ')}`);
                    }
                    const padsMissing = LAYER_PADS_PER[matchedVehicle] - (have['Layer Pad'] || 0);
                    if (padsMissing > 0) missing.push(`Layer Pad x${padsMissing}`);

                    const baseNote = `Auto-assembled by inserts (${matchedVehicle})`;
                    const note = missing.length ? `${baseNote}. Missing: ${missing.join(', ')}` : baseNote;

                    await conn.query(
                        'INSERT INTO containers (set_id, vehicle_type, status, current_location_id, dispatch_time) VALUES (?, ?, "dispatched", ?, NOW())',
                        [newSetId, matchedVehicle, destination_location_id]
                    );
                    await conn.query(
                        'UPDATE components SET set_id = ?, status = "in_use", current_location_id = ? WHERE asset_id IN (?)',
                        [newSetId, destination_location_id, setAssetIds]
                    );

                    if (missing.length) {
                        const excId = 'EXC-' + Math.floor(1000 + Math.random() * 9000);
                        await conn.query(
                            'INSERT INTO exceptions (exception_id, set_id, reason) VALUES (?, ?, ?)',
                            [excId, newSetId, `Set formed with missing parts: ${missing.join(', ')}`]
                        );
                    }

                    const autoChallanNo = `DC-AUTO-${Date.now().toString().slice(-6)}-${i}`;
                    const [challanResult] = await conn.query(
                        `INSERT INTO delivery_challans (challan_no, from_location_id, to_location_id, vehicle_no, driver_name, status) VALUES (?, 1, ?, 'Auto', 'System', 'dispatched')`,
                        [autoChallanNo, destination_location_id]
                    );
                    await conn.query('INSERT INTO challan_sets (challan_id, set_id) VALUES (?, ?)', [challanResult.insertId, newSetId]);

                    for (const comp of setComponents) {
                        await historyController.logHistory('ASSEMBLED', comp.asset_id, { set_id: newSetId, location_id: destination_location_id, note }, conn);
                        await historyController.logHistory('DISPATCHED', comp.asset_id, { set_id: newSetId, challan_no: autoChallanNo, location_id: destination_location_id }, conn);
                    }
                    setsDispatched.push(newSetId);
                }
            }

            // 4. Process any remaining loose components
            if (looseComponents.length > 0) {
                const looseIds = looseComponents.map(c => c.asset_id);
                // ✅ FIX: If receiving or returning, make them available so they can be reused. If dispatching, make them in_use.
                const newLooseStatus = (action === 'receive' || action === 'return') ? 'available' : 'in_use';
                await conn.query(
                    'UPDATE components SET current_location_id = ?, status = ? WHERE asset_id IN (?)',
                    [destination_location_id, newLooseStatus, looseIds]
                );
                for (const comp of looseComponents) {
                    await historyController.logHistory(action === 'dispatch' ? 'DISPATCHED' : (action === 'receive' ? 'RECEIVED' : 'RETURNED'), comp.asset_id, { 
                        location_id: destination_location_id,
                        note: `Scanned as loose component (${newLooseStatus})` 
                    }, conn);
                }
            }
        }

        await conn.commit();
        res.status(200).json({ 
            success: true, 
            message: 'Scan processed successfully.',
            challan_no: challanNo,
            sets_count: setIds.length,
            loose_components_count: looseComponents.length,
            sets_dispatched: setsDispatched
        });

    } catch (err) {
        await conn.rollback();
        res.status(400).json({ error: err.message });
    } finally {
        conn.release();
    }
};

// ── BULK RECEIVE (Customer receives the truck) ──
exports.bulkReceive = async (req, res) => {
    const { scanned_rfid_tags } = req.body;
    if (!scanned_rfid_tags || scanned_rfid_tags.length === 0) return res.status(400).json({ error: 'No tags scanned' });

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        
        const uniqueTags = [...new Set(scanned_rfid_tags)];
        const [components] = await conn.query('SELECT asset_id, set_id FROM components WHERE rfid_tag_id IN (?)', [uniqueTags]);
        const setIds = [...new Set(components.map(c => c.set_id).filter(id => id))];

        if (setIds.length === 0) throw new Error('No valid sets found for the scanned tags.');

        // Check if they are actually dispatched
        const [validSets] = await conn.query('SELECT set_id, current_location_id FROM containers WHERE set_id IN (?) AND status = "dispatched"', [setIds]);
        if (validSets.length !== setIds.length) throw new Error('One or more sets are not in "dispatched" status.');

        const locationId = validSets[0].current_location_id;

        // Update to received
        await conn.query('UPDATE containers SET status = "received", received_at = NOW() WHERE set_id IN (?)', [setIds]);
        
        // Log history for every component
        const [setComps] = await conn.query('SELECT asset_id, set_id FROM components WHERE set_id IN (?)', [setIds]);
        for (const comp of setComps) {
            await historyController.logHistory('RECEIVED', comp.asset_id, { 
                set_id: comp.set_id,
                location_id: locationId,
                note: 'Bulk received at customer'
            }, conn);
        }

        await conn.commit();
        res.json({ success: true, message: `${setIds.length} Sets successfully received.`, sets_count: setIds.length });
    } catch (err) {
        await conn.rollback();
        res.status(400).json({ error: err.message });
    } finally { conn.release(); }
};

// ── BULK RETURN (Empty sets return to hub) ──
exports.bulkReturn = async (req, res) => {
    const { scanned_rfid_tags, return_location_id = 1 } = req.body;
    if (!scanned_rfid_tags || scanned_rfid_tags.length === 0) return res.status(400).json({ error: 'No tags scanned' });

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        
        const uniqueTags = [...new Set(scanned_rfid_tags)];
        const [components] = await conn.query('SELECT set_id FROM components WHERE rfid_tag_id IN (?)', [uniqueTags]);
        const setIds = [...new Set(components.map(c => c.set_id).filter(id => id))];

        if (setIds.length === 0) throw new Error('No valid sets found for the scanned tags.');

        const [validSets] = await conn.query('SELECT set_id, current_location_id FROM containers WHERE set_id IN (?) AND status IN ("dispatched", "received")', [setIds]);
        if (validSets.length !== setIds.length) throw new Error('One or more sets are not in a returnable state.');

        const originLocationId = validSets[0].current_location_id;
        const [componentsBeforeReturn] = await conn.query('SELECT asset_id, set_id FROM components WHERE set_id IN (?)', [setIds]);

        // 1. Update container statuses to returned
        await conn.query(
            'UPDATE containers SET status = "returned", returned_at = NOW(), current_location_id = ? WHERE set_id IN (?)', 
            [return_location_id, setIds]
        );
        
        // 2. THE AUTOMATION: Check if returning to Supa Warehouse (ID 1)
        if (return_location_id === 1) {
            // Auto-Disassemble
            await conn.query(
                'UPDATE components SET current_location_id = ?, set_id = NULL, status = "available" WHERE set_id IN (?)', 
                [return_location_id, setIds]
            );
            // Log Auto-Disassembly for all components
            const allComps = componentsBeforeReturn;
            for (const comp of allComps) {
                await historyController.logHistory('DISASSEMBLED', comp.asset_id, { 
                    set_id: comp.set_id,
                    location_id: return_location_id,
                    note: 'Bulk auto-disassembled at Supa Warehouse'
                }, conn);
            }
        } else {
            // Just move components without unlinking
            await conn.query('UPDATE components SET current_location_id = ? WHERE set_id IN (?)', [return_location_id, setIds]);
        }
        
        // Log Return history
        const setComps = componentsBeforeReturn;
        for (const comp of setComps) {
            await historyController.logHistory('RETURNED', comp.asset_id, { 
                set_id: comp.set_id,
                moved_from_location_id: originLocationId,
                location_id: return_location_id,
                note: 'Bulk returned to hub'
            }, conn);
        }

        await conn.commit();
        res.json({ success: true, message: `${setIds.length} Sets successfully returned to hub and disassembled.`, sets_count: setIds.length });
    } catch (err) {
        await conn.rollback();
        res.status(400).json({ error: err.message });
    } finally { conn.release(); }
};