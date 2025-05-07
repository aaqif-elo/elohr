import {Component, createMemo, createSignal, For, Show} from 'solid-js';
import EmployeeCard from './EmployeeCard';
import {getAdmin, getAvatarUrl} from '~/store';
import {getStatus} from './utils';
import type {UserState} from '~/store';
import FilterSelection from './FilterSelect';
import {formatDuration} from '../util';
import {generateTimeSegments} from '~/store/utils';
import {SpinningCircles} from '../SpinningCircles';

type EmployeeListProps = {
  onUserSelect?: (user: UserState | null) => void;
  loading?: boolean;
};

const EmployeeList: Component<EmployeeListProps> = props => {
  // Wrap getAdmin() in a memo so it re-runs when reactive state changes.
  const adminData = createMemo(() => getAdmin());

  // We'll only render if adminData exists and has a list of users.
  const hasAdminData = createMemo(
    () => adminData() !== null && adminData() !== undefined && !!adminData()!.allUsers
  );

  // Helper function to find the most active time range
  const findMostActiveTimeRange = (segments: {start: Date; end: Date}[]): string => {
    const timeCounts = new Map<number, number>();
    segments.forEach(segment => {
      const startMs = segment.start.getTime();
      const endMs = segment.end.getTime();
      for (let t = startMs; t < endMs; t += 1000 * 60) {
        timeCounts.set(t, (timeCounts.get(t) || 0) + 1);
      }
    });

    const mostActiveTime = Array.from(timeCounts.entries()).reduce(
      (max, current) => (current[1] > max[1] ? current : max),
      [0, 0]
    )[0];

    return new Date(mostActiveTime).toLocaleTimeString();
  };

  const attendanceSummary = createMemo(() => {
    if (!hasAdminData()) return null;

    const users = adminData()!.allUsers;
    const presentUsers = users.filter(
      user => !user.attendance.onLeave && user.attendance.loggedInTime
    );
    const absentUsers = users.filter(
      user => user.attendance.onLeave || !user.attendance.loggedInTime
    );

    // Total work and break times
    const totalWorkTime = users.reduce(
      (sum, user) => sum + (user.attendance.totalWorkTime || 0),
      0
    );
    const totalBreakTime = users.reduce(
      (sum, user) => sum + (user.attendance.totalBreakTime || 0),
      0
    );

    const averageWorkTime = totalWorkTime / users.length || 0;
    const averageBreakTime = totalBreakTime / users.length || 0;

    // Median login and logout times
    const loginTimes = users
      .map(user => user.attendance.loggedInTime)
      .filter(Boolean)
      .sort((a, b) => a!.getTime() - b!.getTime());
    const logoutTimes = users
      .map(user => user.attendance.loggedOutTime)
      .filter(Boolean)
      .sort((a, b) => a!.getTime() - b!.getTime());

    const medianLoginTime =
      loginTimes[Math.floor(loginTimes.length / 2)]?.toLocaleTimeString() || 'N/A';
    const medianLogoutTime =
      logoutTimes[Math.floor(logoutTimes.length / 2)]?.toLocaleTimeString() || 'N/A';

    // Most active project
    const projectCounts = new Map<string, number>();
    users.forEach(user => {
      user.attendance.workSegments.forEach(segment => {
        projectCounts.set(segment.project, (projectCounts.get(segment.project) || 0) + 1);
      });
    });

    const mostActiveProject = Array.from(projectCounts.entries()).reduce(
      (max, current) => (current[1] > max[1] ? current : max),
      ['', 0]
    )[0];

    // Most active work time (time range with the most overlap)
    const activeWorkTimes = users.flatMap(user =>
      user.attendance.workSegments.map(segment => ({
        start: segment.start,
        end: segment.end || new Date(),
      }))
    );

    const mostActiveWorkTimeRange = findMostActiveTimeRange(activeWorkTimes);

    return {
      presentCount: presentUsers.length,
      absentCount: absentUsers.length,
      averageWorkTime: formatDuration(averageWorkTime),
      averageBreakTime: formatDuration(averageBreakTime),
      medianLoginTime,
      medianLogoutTime,
      mostActiveProject,
      mostActiveWorkTimeRange,
    };
  });

  // Signals for the filter options
  const [searchTerm, setSearchTerm] = createSignal('');
  const [selectedProjects, setSelectedProjects] = createSignal<string[]>(['All']);
  const [selectedRoles, setSelectedRoles] = createSignal<string[]>(['All']);
  const [selectedUserId, setSelectedUserId] = createSignal<string | null>(null);

  // Compute a list of all unique projects
  const allProjects = createMemo((): string[] => {
    if (!hasAdminData()) return [];
    const projectsSet = new Set<string>();
    adminData()!.allUsers.forEach(user => {
      user.attendance.workSegments?.forEach(segment => {
        projectsSet.add(segment.project);
      });
    });
    return Array.from(projectsSet);
  });

  // Compute a list of all unique roles from the users
  const allRoles = createMemo((): string[] => {
    if (!hasAdminData()) return [];
    const rolesSet = new Set<string>();
    adminData()!.allUsers.forEach(user => {
      user.roles.forEach(role => rolesSet.add(role));
    });
    return Array.from(rolesSet);
  });

  // Helper function to extract the list of projects an employee worked on.
  const getUserProjects = (user: UserState): string[] => {
    const segments = generateTimeSegments(user.attendance);
    const projectsSet = new Set<string>();
    segments.forEach(segment => {
      if (segment.type === 'work' && segment.channel) {
        projectsSet.add(segment.channel);
      }
    });
    return Array.from(projectsSet);
  };

  // Filter the list of users based on the selected filters
  const filteredUsers = createMemo((): UserState[] => {
    if (!hasAdminData()) return [];
    return adminData()!.allUsers.filter(user => {
      // Filter by name (case-insensitive)
      if (searchTerm() && !user.name.toLowerCase().includes(searchTerm().toLowerCase())) {
        return false;
      }
      // Filter by projects. If "All" is selected, we ignore this filter.
      if (!selectedProjects().includes('All')) {
        const userProjects = getUserProjects(user);
        if (!userProjects.some(project => selectedProjects().includes(project))) {
          return false;
        }
      }
      // Filter by roles. If "All" is selected, we ignore this filter.
      if (!selectedRoles().includes('All')) {
        if (!user.roles.some(role => selectedRoles().includes(role))) {
          return false;
        }
      }
      return true;
    });
  });

  // Sorted list of filtered users by status: present -> on break -> absent
  const sortedFilteredUsers = createMemo((): UserState[] => {
    const statusOrder: Record<string, number> = {
      present: 0,
      'on break': 1,
      absent: 2,
    };

    return [...filteredUsers()].sort((a, b) => {
      const aStatus = getStatus(a.attendance);
      const bStatus = getStatus(b.attendance);
      return statusOrder[aStatus] - statusOrder[bStatus];
    });
  });

  // Toggle functions for project and role selections
  const toggleProject = (project: string) => {
    if (selectedProjects().includes('All')) {
      setSelectedProjects(selectedProjects().filter(item => item !== 'All'));
    }
    if (selectedProjects().includes(project)) {
      const newSelection = selectedProjects().filter(item => item !== project);
      setSelectedProjects(newSelection.length ? newSelection : ['All']);
    } else {
      setSelectedProjects([...selectedProjects(), project]);
    }
  };

  const toggleRole = (role: string) => {
    if (selectedRoles().includes('All')) {
      setSelectedRoles(selectedRoles().filter(item => item !== 'All'));
    }
    if (selectedRoles().includes(role)) {
      const newSelection = selectedRoles().filter(item => item !== role);
      setSelectedRoles(newSelection.length ? newSelection : ['All']);
    } else {
      setSelectedRoles([...selectedRoles(), role]);
    }
  };

  return (
    <Show
      when={!props.loading}
      fallback={
        <div class="flex items-center justify-center p-4">
          <SpinningCircles height={25} />
        </div>
      }
    >
      <Show when={hasAdminData()}>
        <div class="p-4">
          {/* Attendance Summary */}
          <div class="mb-6 rounded-lg bg-gray-100 p-4 dark:bg-neutral-800">
            <h2 class="mb-2 text-lg font-bold">Attendance Summary</h2>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <span class="font-bold">Present:</span> {attendanceSummary()?.presentCount || 0}
              </div>
              <div>
                <span class="font-bold">Absent:</span> {attendanceSummary()?.absentCount || 0}
              </div>
              <div>
                <span class="font-bold">Avg Work Time:</span>{' '}
                {attendanceSummary()?.averageWorkTime || '00:00:00'}
              </div>
              <div>
                <span class="font-bold">Avg Break Time:</span>{' '}
                {attendanceSummary()?.averageBreakTime || '00:00:00'}
              </div>
              <div>
                <span class="font-bold">Median Login Time:</span>{' '}
                {attendanceSummary()?.medianLoginTime || 'N/A'}
              </div>
              <div>
                <span class="font-bold">Median Logout Time:</span>{' '}
                {attendanceSummary()?.medianLogoutTime || 'N/A'}
              </div>
              <div>
                <span class="font-bold">Most Active Project:</span>{' '}
                {attendanceSummary()?.mostActiveProject || 'N/A'}
              </div>
              <div>
                <span class="font-bold">Most Active Work Time:</span>{' '}
                {attendanceSummary()?.mostActiveWorkTimeRange || 'N/A'}
              </div>
            </div>
          </div>
          {/* Filter Section */}
          <div class="mb-6 space-y-4">
            {/* 1. Search by Name */}
            <div>
              <input
                type="text"
                placeholder="Search by name"
                value={searchTerm()}
                onInput={e => setSearchTerm(e.currentTarget.value)}
                class="w-full rounded border p-2 dark:bg-neutral-900"
              />
            </div>
            {/* 2. Filter by Projects */}
            <div>
              <span class="font-bold">Projects:</span>
              <FilterSelection
                availableFilters={allProjects()}
                selectedFilters={selectedProjects()}
                onSelect={project => toggleProject(project)}
                onDeselect={project => toggleProject(project)}
              />
            </div>
            {/* 3. Filter by Roles */}
            <div>
              <span class="font-bold">Roles:</span>
              <FilterSelection
                availableFilters={allRoles()}
                selectedFilters={selectedRoles()}
                onSelect={role => toggleRole(role)}
                onDeselect={role => toggleRole(role)}
              />
            </div>
          </div>
          {/* Employee Cards List */}
          <div class="grid grid-cols-1 gap-4">
            <For each={sortedFilteredUsers()}>
              {user => (
                <EmployeeCard
                  id={user.dbID}
                  name={user.name}
                  avatarUrl={getAvatarUrl(user.discordID, user.discordAvatarId)}
                  roles={user.roles}
                  attendance={user.attendance}
                  onselect={id => {
                    if (user.dbID === selectedUserId()) {
                      setSelectedUserId(null);
                      if (props.onUserSelect) props.onUserSelect(null);
                    } else {
                      setSelectedUserId(id);
                      if (props.onUserSelect) props.onUserSelect(user);
                    }
                  }}
                  selected={() => selectedUserId() === user.dbID}
                />
              )}
            </For>
          </div>
        </div>
      </Show>
    </Show>
  );
};

export default EmployeeList;
