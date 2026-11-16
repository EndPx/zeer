#!/usr/bin/env python3
"""Recalculate the published dated capacity model and bounded acceptance."""
import json
import math
from pathlib import Path


def verify(proof):
    plan = proof['forecast']
    basis = plan['basis']
    interval = (basis['archiveFrozenAtUnix'] - basis['archiveStartAtUnix']) / 86400
    assert math.isclose(interval, basis['activeIntervalDays'], abs_tol=1e-9)
    daily = plan['dailyGrowthBytes']
    assert math.isclose(daily['archiveIncludingRetiredCopies'],
                        (basis['archiveFrozenBytes'] - basis['archiveStartBytes']) / interval,
                        rel_tol=1e-9)
    node_interval = (basis['archiveFrozenAtUnix'] - basis['nodeStartAtUnix']) / 86400
    assert math.isclose(daily['nodeAllocated'],
                        (basis['nodeFrozenBytes'] - basis['nodeStartBytes']) / node_interval,
                        rel_tol=1e-9)
    growth = plan['forecastGrowthBytes']
    assert abs(growth['archive'] - daily['archiveIncludingRetiredCopies'] * plan['forecastDays'] * plan['safetyFactor']) < 1
    assert abs(growth['node'] - daily['nodeAllocated'] * plan['forecastDays'] * plan['safetyFactor']) < 1
    assert growth['total'] == sum(growth[k] for k in ['archive', 'node', 'databaseLogOtherAllowance', 'oneTimeCatchupAllowance'])
    assert growth['oneTimeCatchupAllowance'] == growth['oneTimeCatchupArchiveShare'] + growth['oneTimeCatchupNodeShare']
    current, projected, allocation = plan['current'], plan['projected'], proof['allocation']
    assert projected['aggregateBytes'] == current['aggregateBytes'] + growth['total']
    assert projected['physicalFreeBytes'] == current['physicalFreeBytes'] - growth['total']
    assert projected['archiveBytesIncludingAppendReserve'] == current['archiveBytes'] + growth['archive'] + growth['oneTimeCatchupArchiveShare'] + 256 * 1024**2
    assert projected['aggregateBytes'] < allocation['aggregateStopGiB'] * 1024**3
    assert projected['archiveBytesIncludingAppendReserve'] < allocation['prepArchiveGiB'] * 1024**3
    assert projected['physicalFreeBytes'] > allocation['minimumPhysicalFreeGiBUnchanged'] * 1024**3
    acceptance = proof['boundedAcceptance']
    assert acceptance['evaluationWindowSeconds'] >= 900
    assert acceptance['sourceReadyFraction'] >= 0.9 and acceptance['consumerReadyFraction'] >= 0.8
    assert acceptance['blocksAdvancedInWindow'] >= 20
    assert acceptance['nodeUptimeSeconds'] >= 2400
    assert acceptance['followerRestarts'] == acceptance['prepOomKills'] == 0
    assert proof['finalChecks']['financialSupervisorPaused'] and proof['finalChecks']['financialBaselineUnchanged']


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    verify(json.loads((root / 'apps/docs/static/operations/2026-11-16-capacity-recovery.json').read_text()))
    print('PASS: dated capacity arithmetic, safety margins and bounded acceptance')
