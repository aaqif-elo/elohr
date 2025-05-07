import {
  Break,
  ContractType,
  User,
  UserRoleTypes,
  WorkSegment,
  Attendance as DbAttendance,
} from '@prisma/client';
import {createStore} from 'solid-js/store';
import {
  calculateMsWorkedOrBreaksTaken,
  convertTrpcAttendanceToDbAttendance,
  convertTrpcUserToDbUser,
  generateTimeSegmentPreState,
  TrpcAttendance,
  TrpcUser,
  TrpcUserWithAttendance,
  convertTrpcAttendanceSummaryToAttendanceSummary,
} from './utils';
import {AttendanceSummary, TrpcAttendanceSummary} from '../types/attendance';

export interface Attendance {
  onLeave: boolean;
  leaveReason?: string;
  leave?: {
    reason?: string;
    until: Date;
    approvedBy: string;
  };
  loggedInTime?: Date;
  loggedOutTime?: Date;
  breaks: Break[];
  workSegments: WorkSegment[];
  totalBreakTime: number;
  totalWorkTime: number;
}

export interface UserState {
  name: string;
  dbID: string;
  discordID: string;
  discordUserName: string;
  discordAvatarId: string;
  roles: UserRoleTypes[];
  orgEmail: string;
  userEmail: string;
  attendance: Attendance;
  attendanceSummary?: AttendanceSummary;
  contract?: {
    type: ContractType;
    start: Date;
    reviewDate: Date;
    salaryInBDT: number;
    createdAt: Date | null;
    updatedAt: Date | null;
  };
}

interface State {
  user?: UserState;
  admin?: {
    allUsers: UserState[];
  };
}

const [state, setState] = createStore<State>({});

const dbUserToUserState = (dbUser: User, attendance?: DbAttendance) => {
  let attendanceState: Attendance = {
    onLeave: false,
    breaks: [],
    workSegments: [],
    totalBreakTime: 0,
    totalWorkTime: 0,
  };
  if (attendance) {
    attendanceState = dbAttendanceToAttendanceState(attendance);
  }
  return {
    name: dbUser.name,
    dbID: dbUser.id,
    discordID: dbUser.discordInfo.id,
    discordUserName: dbUser.discordInfo.username,
    discordAvatarId: dbUser.discordInfo.avatar,
    roles: dbUser.roles,
    orgEmail: dbUser.orgEmail,
    userEmail: dbUser.userEmail,
    attendance: attendanceState,
    contract: dbUser.contracts[0]
      ? {
          type: dbUser.contracts[0].contractType,
          start: dbUser.contracts[0].startDate,
          reviewDate: dbUser.contracts[0].reviewDate,
          salaryInBDT: dbUser.contracts[0].salaryInBDT,
          createdAt: dbUser.contracts[0].createdAt,
          updatedAt: dbUser.contracts[0].updatedAt,
        }
      : undefined,
  };
};

export const setUser = (trpcUser: TrpcUser) => {
  const dbUser = convertTrpcUserToDbUser(trpcUser);
  const userState = dbUserToUserState(dbUser);

  setState('user', userState);
};

const dbAttendanceToAttendanceState = (dbAttendance: DbAttendance) => {
  return {
    onLeave: false,
    loggedInTime: dbAttendance.login,
    loggedOutTime: dbAttendance.logout ?? undefined,
    breaks: dbAttendance.breaks,
    workSegments: dbAttendance.workSegments,
    totalBreakTime: dbAttendance.totalBreak || calculateMsWorkedOrBreaksTaken(dbAttendance.breaks),
    totalWorkTime:
      dbAttendance.totalWork ||
      calculateMsWorkedOrBreaksTaken(
        dbAttendance.workSegments ||
          generateTimeSegmentPreState(dbAttendance).filter(segment => segment.type === 'work')
      ),
  };
};

export const setAttendance = (attendance: TrpcAttendance | null) => {
  if (!state.user) return;
  if (!attendance) {
    setState({
      user: {
        ...state.user,
        attendance: {
          onLeave: false,
          breaks: [],
          workSegments: [],
          totalBreakTime: 0,
          totalWorkTime: 0,
        },
      },
    });
    return;
  }
  const dbAttendance = convertTrpcAttendanceToDbAttendance(attendance);
  setState({
    user: {
      ...state.user,
      attendance: dbAttendanceToAttendanceState(dbAttendance),
    },
  });
};

export const setAdmin = (allUsers: TrpcUserWithAttendance[]) => {
  const userStates: UserState[] = [];
  allUsers.forEach(user => {
    const dbUser = convertTrpcUserToDbUser(user);
    const userState = dbUserToUserState(dbUser);
    if (user.attendance) {
      userState.attendance = dbAttendanceToAttendanceState(
        convertTrpcAttendanceToDbAttendance(user.attendance)
      );
    }
    userStates.push(userState);
  });

  setState({
    admin: {
      allUsers: userStates,
    },
  });
};

export const getAdmin = () => state.admin;
export const getUser = () => state.user;
export const getAvatarUrl = (discordID: string, discordAvatarId: string) =>
  `https://cdn.discordapp.com/avatars/${discordID}/${discordAvatarId}.png`;

export const setAttendanceSummary = (summary: TrpcAttendanceSummary) => {
  if (!state.user) return;

  const convertedSummary = convertTrpcAttendanceSummaryToAttendanceSummary(summary);
  setState({
    user: {
      ...state.user,
      attendanceSummary: convertedSummary,
    },
  });
};
