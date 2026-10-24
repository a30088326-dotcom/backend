import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

const offset = 330 * 60000;
export const attendanceDateTime = (date: Date) => new Date(date.getTime() + offset).toISOString().slice(0, 19).replace('T', ' ');
export const attendanceTimestamp = (value: Date | string) => value instanceof Date ? value.getTime()
  : Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(' ', 'T') + '+05:30');
export const attendanceDate = (value: Date | string) => attendanceDateTime(new Date(attendanceTimestamp(value))).slice(0, 10);
export function attendanceRange(date: string, inTime: string, outTime: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) !== date ||
      ![inTime, outTime].every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || inTime === outTime) throw new Error('A valid date and different in/out times are required.');
  const end = new Date(date + 'T12:00:00Z');
  if (outTime < inTime) end.setUTCDate(end.getUTCDate() + 1);
  return { inTime: `${date} ${inTime}:00`, outTime: `${end.toISOString().slice(0, 10)} ${outTime}:00` };
}

export async function shiftForDate(connection: PoolConnection, employeeId: string, date: string, savedShiftId?: string) {
  if (savedShiftId) {
    const [[saved]] = await connection.query<RowDataPacket[]>('SELECT * FROM attendance_shifts WHERE id=?', [savedShiftId]);
    if (saved) return saved;
  }
  const [[assignment]] = await connection.query<RowDataPacket[]>(`SELECT a.*,COALESCE(a.groupId,a.rosterGroupId) roster
    FROM attendance_roster_assignments a WHERE employeeId=? AND status='Active'
    AND COALESCE(effectiveStartDate,effectiveFrom)<=? AND (COALESCE(effectiveEndDate,effectiveTo) IS NULL OR COALESCE(effectiveEndDate,effectiveTo)>=?)
    ORDER BY COALESCE(effectiveStartDate,effectiveFrom) DESC,a.createdAt DESC LIMIT 1`, [employeeId,date,date]);
  if (!assignment) return null;
  const [[calendar]] = await connection.query<RowDataPacket[]>('SELECT shiftId,isOffDay FROM attendance_roster_calendars WHERE rosterGroupId=? AND date=? LIMIT 1',[assignment.roster,date]);
  if (calendar?.isOffDay) return null;
  const [[shift]] = await connection.query<RowDataPacket[]>(calendar?.shiftId
    ? 'SELECT * FROM attendance_shifts WHERE id=?'
    : `SELECT s.* FROM attendance_roster_group_shifts m JOIN attendance_shifts s ON s.id=m.shiftId
       WHERE m.groupId=? OR m.rosterGroupId=? ORDER BY m.isDefault DESC,m.displayOrder,s.id LIMIT 1`, calendar?.shiftId ? [calendar.shiftId] : [assignment.roster,assignment.roster]);
  if (shift) return shift;
  if (assignment.shiftId) { const [[fallback]] = await connection.query<RowDataPacket[]>('SELECT * FROM attendance_shifts WHERE id=?',[assignment.shiftId]); return fallback || null; }
  return null;
}

type Log = { timestamp: Date | string; logType: string };
export async function workingDate(connection: Pick<PoolConnection,'query'>, employeeId:string, now=new Date()) {
  const [[last]]=await connection.query<RowDataPacket[]>('SELECT timestamp,logType FROM attendance_raw_logs WHERE employeeId=? AND timestamp>=? AND timestamp<=? ORDER BY timestamp DESC LIMIT 1',[employeeId,attendanceDateTime(new Date(now.getTime()-36*3600000)),attendanceDateTime(now)]);
  if(last && last.logType!=='Out') {
    const [[opened]]=await connection.query<RowDataPacket[]>("SELECT timestamp FROM attendance_raw_logs WHERE employeeId=? AND logType='In' AND timestamp<=? ORDER BY timestamp DESC LIMIT 1",[employeeId,attendanceDateTime(now)]);
    if(opened)return attendanceDate(opened.timestamp);
  }
  return attendanceDate(now);
}
export async function workingLogs(connection: Pick<PoolConnection,'query'>,employeeId:string,date:string,now=new Date()) {
  const [logs]=await connection.query<RowDataPacket[]>('SELECT id,timestamp,logType,source FROM attendance_raw_logs WHERE employeeId=? AND timestamp>=? AND timestamp<=? ORDER BY timestamp ASC,id ASC',[employeeId,date+' 00:00:00',attendanceDateTime(now)]);
  return logs;
}
export function calculateAttendance(date: string, firstIn: Date | string, lastOut: Date | string, shift: any, logs?: Log[]) {
  const start = attendanceTimestamp(firstIn), end = attendanceTimestamp(lastOut);
  let gross = Math.max(0,end-start), breaks = 0;
  if (logs?.length) {
    gross=0; let opened: number | null=null, breakStart: number | null=null;
    for (const log of logs) {
      const time=attendanceTimestamp(log.timestamp);
      if(log.logType==='In') { opened=time; breakStart=null; }
      if(log.logType==='BreakIn' && opened!==null) breakStart=time;
      if(log.logType==='BreakOut' && breakStart!==null) { breaks+=Math.max(0,time-breakStart); breakStart=null; }
      if(log.logType==='Out' && opened!==null) { gross+=Math.max(0,time-opened); if(breakStart!==null)breaks+=Math.max(0,time-breakStart); opened=null;breakStart=null; }
    }
    if(opened!==null) { gross+=Math.max(0,end-opened);if(breakStart!==null)breaks+=Math.max(0,end-breakStart); }
  } else if (shift?.breakType === 'Unpaid') {
    // Approved/manual intervals have no break punches; apply the configured break once.
    breaks=Math.min(gross,Math.max(0,Number(shift.breakDuration)||0)*3600000);
  }
  const hours = Math.max(0,(gross-(shift?.breakType==='Paid'?0:breaks))/3600000);
  let scheduled=Number(shift?.totalHours)||0;
  if(!scheduled && shift?.startTime && shift?.endTime) scheduled=((Number(String(shift.endTime).slice(0,2))*60+Number(String(shift.endTime).slice(3,5)) - Number(String(shift.startTime).slice(0,2))*60-Number(String(shift.startTime).slice(3,5))+1440)%1440)/60;
  const standard=Number(shift?.fullDayHours)>0?Number(shift.fullDayHours):Math.max(0,scheduled-(shift?.breakType==='Unpaid'?Number(shift.breakDuration)||0:0));
  const extra=shift && standard>0 ? Math.max(0,hours-standard) : 0;
  const overtime=shift?.overtimeEligible && extra*60>=Math.max(0,Number(shift.overtimeStart)||0) ? extra : 0;
  let lateMinutes=0,earlyDepartureMinutes=0;
  if(shift?.startTime && shift?.endTime) {
    const range=attendanceRange(date,String(shift.startTime).slice(0,5),String(shift.endTime).slice(0,5));
    lateMinutes=Math.max(0,Math.floor((start-attendanceTimestamp(range.inTime))/60000)-(Number(shift.graceLate)||0));
    earlyDepartureMinutes=Math.max(0,Math.floor((attendanceTimestamp(range.outTime)-end)/60000)-(Number(shift.graceEarly)||0));
  }
  const round=(n:number)=>Number(n.toFixed(2));
  return {shiftId:shift?.id||null,totalHours:round(hours),regularHours:round(shift && standard>0?Math.min(hours,standard):hours),overtimeHours:round(overtime),lateMinutes,earlyDepartureMinutes,isLate:lateMinutes>0?1:0};
}

export async function saveAttendance(connection: PoolConnection, recordId: string, employeeId: string, date: string,
  firstIn: Date | string, lastOut: Date | string, options: {logs?:Log[];savedShiftId?:string;status?:string;isException?:number}={}) {
  const shift=await shiftForDate(connection,employeeId,date,options.savedShiftId);
  const result=calculateAttendance(date,firstIn,lastOut,shift,options.logs);
  await connection.query(`UPDATE attendance_records SET shiftId=?,inTime=?,outTime=?,totalHours=?,regularHours=?,overtimeHours=?,
    lateMinutes=?,earlyDepartureMinutes=?,isLate=?,status=?,isException=?,updatedAt=NOW() WHERE id=?`,
    [result.shiftId,attendanceDateTime(new Date(attendanceTimestamp(firstIn))),attendanceDateTime(new Date(attendanceTimestamp(lastOut))),result.totalHours,result.regularHours,result.overtimeHours,result.lateMinutes,result.earlyDepartureMinutes,result.isLate,options.status||'Present',options.isException||0,recordId]);
  return result;
}
