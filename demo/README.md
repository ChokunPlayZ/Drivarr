# Drivarr standalone demo

Open `index.html` directly in a modern browser. The demo has no dependencies,
does not contact the daemon, and never accesses hardware or a network.

The interface includes realistic device telemetry, a deliberately quarantined
drive, SMART and FARM details that remain viewable while tests run, ordered
multi-test suites, simulated job progress and controls, a live bad-block drive
map, destructive-test confirmation, reports, local PDF generation, users,
settings, profiles, grading policies, retention controls, and audit history.
Click any drive path in the drive cards or test tables to open its full-screen
workspace with live progress controls, the complete surface map, all available
SMART attributes, all FARM counters, and the retained test timeline.

Exported demo reports are styled two-page PDFs containing the drive identity,
test-suite evidence, detailed SMART attributes, Seagate FARM metrics, the
color-coded sector map, integrity hashes, and SMART-history consistency
analysis. History-reset detection is heuristic: it highlights contradictions
between independent counters but does not claim to prove intentional tampering.

Use **Reset demo** in the top bar to restore the original sample data.
