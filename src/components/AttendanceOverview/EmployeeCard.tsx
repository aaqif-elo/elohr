import {Component, createMemo, JSX} from 'solid-js';
import {Attendance} from '~/store';
import {formatDuration} from '../util';
import {getStatus} from './utils';

type EmployeeCardProps = {
  id: string;
  name: string;
  avatarUrl: string; // e.g. a Discord avatar hash
  roles: string[];
  attendance?: Attendance;
  selected: () => boolean;
  onselect: (id: string) => void;
};

const EmployeeCard: Component<EmployeeCardProps> = props => {
  // Compute the status based on attendance.
  const status = getStatus(props.attendance);

  // Determine the most active project by summing work segments.
  const getMostActiveProject = (): string | null => {
    if (
      !props.attendance ||
      !props.attendance.workSegments ||
      props.attendance.workSegments.length === 0
    ) {
      return null;
    }
    const projectTotals: Record<string, number> = {};
    props.attendance.workSegments.forEach(seg => {
      projectTotals[seg.project] = (projectTotals[seg.project] || 0) + (seg.length_ms ?? 0);
    });
    let maxProject: string | null = null;
    let maxTime = 0;
    for (const project in projectTotals) {
      if (projectTotals[project] > maxTime) {
        maxTime = projectTotals[project];
        maxProject = project;
      }
    }
    return maxProject;
  };

  const mostActiveProject = getMostActiveProject();

  // Define a chip style for the status that uses the indicator color as its background.
  const statusChipStyle: JSX.CSSProperties = {
    display: 'inline-flex',
    'align-items': 'center',
    'background-color': status === 'present' ? 'green' : status === 'on break' ? 'orange' : 'red',
    color: 'white',
    padding: '4px 8px',
    'border-radius': '12px',
    'font-size': '14px',
    'margin-bottom': '4px',
  };

  // Show work details if logged in; otherwise show "Absent."
  const attendanceContent: JSX.Element =
    props.attendance && props.attendance.loggedInTime ? (
      <div style={{'margin-top': '8px', 'font-size': '14px'}}>
        {/* Render the status chip inline */}
        <div style={statusChipStyle}>{status}</div>
        {typeof props.attendance.totalWorkTime === 'number' && (
          <div>Total Worked: {formatDuration(props.attendance.totalWorkTime)}</div>
        )}
        {typeof props.attendance.totalBreakTime === 'number' && (
          <div>Total Breaks: {formatDuration(props.attendance.totalBreakTime)}</div>
        )}
        {mostActiveProject && <div>Most Active Project: {mostActiveProject}</div>}
      </div>
    ) : (
      <div style={{'margin-top': '8px', 'font-size': '14px'}}>Absent</div>
    );

  // Basic styles – you might want to move these into your CSS.
  const cardStyle = createMemo<JSX.CSSProperties>(() => ({
    border: props.selected() ? '2px solid blue' : '1px solid #ccc',
    padding: '10px',
    'border-radius': '8px',
    cursor: 'pointer',
    display: 'flex',
    'align-items': 'center',
    'margin-bottom': '10px',
  }));

  const avatarStyle: JSX.CSSProperties = {
    width: '50px',
    height: '50px',
    'border-radius': '50%',
    'margin-right': '10px',
  };

  const chipStyle: JSX.CSSProperties = {
    'background-color': '#eee',
    color: '#333',
    padding: '2px 8px',
    'border-radius': '12px',
    'margin-right': '4px',
    'font-size': '12px',
  };

  return (
    <div style={cardStyle()} onClick={() => props.onselect(props.id)} role="button" tabIndex={0}>
      {/* Avatar */}
      <img src={props.avatarUrl} alt={`${props.name}'s avatar`} style={avatarStyle} />

      {/* Employee details */}
      <div>
        <div style={{'font-weight': 'bold', 'font-size': '16px'}}>{props.name}</div>
        <div>
          {props.roles.map(role => (
            <span style={chipStyle}>{role}</span>
          ))}
        </div>
        {attendanceContent}
      </div>
    </div>
  );
};

export default EmployeeCard;
