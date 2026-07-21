import type {
  ContractType,
  User,
  UserRoleTypes,
  WorkSegment,
  Attendance as DbAttendance,
} from '@prisma/client';
import {createStore} from 'solid-js/store';
import type {
  TrpcAttendance,
  TrpcUser,
  TrpcUserWithAttendance} from './utils';
import {
  calculateTotalWorkMs,
  convertTrpcAttendanceToDbAttendance,
  convertTrpcUserToDbUser,
  convertTrpcAttendanceSummaryToAttendanceSummary,
} from './utils';
import type {AttendanceSummary, TrpcAttendanceSummary} from '../types/attendance';

export interface Attendance {
  workSegments: WorkSegment[];
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
  const attendanceState: Attendance = attendance
    ? dbAttendanceToAttendanceState(attendance)
    : { workSegments: [], totalWorkTime: 0 };

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

const dbAttendanceToAttendanceState = (dbAttendance: DbAttendance): Attendance => {
  return {
    workSegments: dbAttendance.workSegments,
    totalWorkTime: dbAttendance.totalWork || calculateTotalWorkMs(dbAttendance.workSegments),
  };
};

export const setAttendance = (attendance: TrpcAttendance | null) => {
  if (!state.user) return;
  if (!attendance) {
    setState({
      user: {
        ...state.user,
        attendance: { workSegments: [], totalWorkTime: 0 },
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

  setState({ admin: { allUsers: userStates } });
};

export const getAdmin = () => state.admin;
export const getUser = () => state.user;
export const getAvatarUrl = (discordID: string, discordAvatarId: string) =>
  `https://cdn.discordapp.com/avatars/${discordID}/${discordAvatarId}`;

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
