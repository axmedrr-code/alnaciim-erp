function canResolveDowntime(downtime) {
  return Boolean(downtime && !downtime.end_time);
}

function shouldRestoreMachineOperational(machineStatus, otherOpenDowntimeCount) {
  return machineStatus === 'breakdown' && Number(otherOpenDowntimeCount) === 0;
}

module.exports = { canResolveDowntime, shouldRestoreMachineOperational };
