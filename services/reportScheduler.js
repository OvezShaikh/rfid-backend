// services/reportScheduler.js
const cron = require('node-cron');
const fs = require('fs');
const { aggregate } = require('./reportAggregator');
const { renderReportPdf } = require('./reportPdf');
const emailTrigger = require('./emailTrigger');

const TZ = 'Asia/Kolkata';
const EVENT_KEY = {
  week:  'report_weekly',
  month: 'report_monthly',
  year:  'report_yearly',
};

async function runReport(period, referenceDate = new Date()) {
  const t0 = Date.now();
  try {
    console.log(`[report] generating ${period} report...`);
    const agg = await aggregate(period, referenceDate);
    const { filePath } = await renderReportPdf(agg);

    const result = await emailTrigger.trigger(
      EVENT_KEY[period],
      {
        period_label: agg.label,
        period_start: agg.start.toISOString(),
        period_end: agg.end.toISOString(),
        total_challans: agg.totals.challans,
        total_sets: agg.totals.sets,
        total_components: agg.totals.components,
        exceptions: agg.totals.exceptions,
        returned_sets: agg.totals.returnedSets,
        avg_turnaround_hours: agg.totals.avgTurnaroundHours,
      },
      {
        attachments: [
          { filename: `${period}-report-${agg.label}.pdf`, path: filePath },
        ],
      }
    );

    console.log(`[report] ${period} → ${JSON.stringify(result)} in ${Date.now() - t0}ms`);
    fs.unlink(filePath, () => {});
    return result;
  } catch (err) {
    console.error(`[report] ${period} FAILED:`, err.message);
    throw err;
  }
}

function startScheduler() {
  // Weekly: every Monday 06:00 IST
  cron.schedule('0 6 * * 1', () => runReport('week').catch(() => {}), { timezone: TZ });

  // Monthly: 1st of month 06:00 IST
  cron.schedule('0 6 1 * *', () => runReport('month').catch(() => {}), { timezone: TZ });

  // Yearly: Jan 1st 06:00 IST — reports on the PREVIOUS year
  cron.schedule('0 6 1 1 *', () => {
    const prev = new Date();
    prev.setFullYear(prev.getFullYear() - 1);
    runReport('year', prev).catch(() => {});
  }, { timezone: TZ });


  console.log(`[report] scheduler started (TZ: ${TZ})`);
}

module.exports = { startScheduler, runReport };