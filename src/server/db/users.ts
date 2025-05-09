import { Attendance, User, UserRoleTypes } from "@prisma/client";
import { db, getAttendanceForUser, getStartAndEndOfDay } from ".";

// 1. Overload signatures
export async function getUserByDiscordId(
  discordUserId: string,
  withAttendance: true
): Promise<{ user: User; attendance: Attendance | null }>;

export async function getUserByDiscordId(
  discordUserId: string,
  withAttendance?: false
): Promise<User>;

// 2. Implementation signature
export async function getUserByDiscordId(
  discordUserId: string,
  withAttendance = false
): Promise<User | { user: User; attendance: Attendance | null }> {
  const user = await db.user.findFirst({
    where: {
      discordInfo: {
        is: {
          id: discordUserId,
        },
      },
      exEmployee: false,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  if (withAttendance) {
    const attendance = await getAttendanceForUser(user.id);
    return { user, attendance };
  } else {
    return user;
  }
}

export async function getUserById(userId: string) {
  const user = await db.user.findFirst({
    where: {
      id: userId,
      exEmployee: false,
    },
  });
  if (!user) {
    throw new Error("User not found");
  }
  return user;
}

export async function getDiscordIdsFromUserIds(
  userIds: string[]
): Promise<{ id: string; discordId: string }[]> {
  const users = await db.user.findMany({
    where: {
      id: { in: userIds },
      exEmployee: false,
    },
    select: {
      id: true,
      discordInfo: {
        select: {
          id: true,
        },
      },
    },
  });

  return users.map((user) => ({
    id: user.id,
    discordId: user.discordInfo?.id || "",
  }));
}

export async function getAllEmployeesWithAttendance(date: Date) {
  const { start, end } = getStartAndEndOfDay(date);

  const employeeWithAttendances = await db.user.aggregateRaw({
    pipeline: [
      // 1. Match current employees.
      {
        $match: {
          exEmployee: false,
        },
      },
      // 2. Lookup attendance records for each employee.
      {
        $lookup: {
          from: "attendances",
          let: { userId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$user", "$$userId"] },
                    { $gte: ["$login", { $toDate: start.toISOString() }] },
                    { $lte: ["$login", { $toDate: end.toISOString() }] },
                  ],
                },
              },
            },
            // 3. Project and convert date and ObjectId fields.
            {
              $project: {
                // Convert top-level date fields to strings.
                login: {
                  $dateToString: {
                    date: "$login",
                    format: "%Y-%m-%dT%H:%M:%S.%LZ",
                  },
                },
                logout: {
                  $dateToString: {
                    date: "$logout",
                    format: "%Y-%m-%dT%H:%M:%S.%LZ",
                  },
                },
                // Convert the attendance document's own _id and user reference to strings.
                _id: { $toString: "$_id" },
                user: { $toString: "$user" },
                // Convert dates in the breaks array.
                breaks: {
                  $map: {
                    input: { $ifNull: ["$breaks", []] }, // Use an empty array if workSegments is null.
                    as: "b",
                    in: {
                      start: {
                        $dateToString: {
                          date: "$$b.start",
                          format: "%Y-%m-%dT%H:%M:%S.%LZ",
                        },
                      },
                      end: {
                        $dateToString: {
                          date: "$$b.end",
                          format: "%Y-%m-%dT%H:%M:%S.%LZ",
                        },
                      },
                      reason: "$$b.reason",
                      _id: { $toString: "$$b._id" },
                    },
                  },
                },
                // Convert dates in the workSegments array.
                workSegments: {
                  $map: {
                    input: { $ifNull: ["$workSegments", []] }, // Use an empty array if workSegments is null.
                    as: "ws",
                    in: {
                      start: {
                        $dateToString: {
                          date: "$$ws.start",
                          format: "%Y-%m-%dT%H:%M:%S.%LZ",
                        },
                      },
                      end: {
                        $dateToString: {
                          date: "$$ws.end",
                          format: "%Y-%m-%dT%H:%M:%S.%LZ",
                        },
                      },
                      project: "$$ws.project",
                      _id: { $toString: "$$ws._id" },
                    },
                  },
                },
                // Include other fields as needed.
                totalBreak: "$total_break",
                totalTime: "$total_time",
                totalWork: "$total_work",
                __v: 1,
              },
            },
          ],
          as: "attendance",
        },
      },
      // 4. Unwind the attendance array (if applicable).
      {
        $unwind: {
          path: "$attendance",
          preserveNullAndEmptyArrays: true,
        },
      },
      // 5. Convert the main user document's _id to a string.
      {
        $addFields: {
          id: { $toString: "$_id" },
        },
      },
    ],
  });

  return employeeWithAttendances as unknown as (User & {
    attendance?: Attendance;
  })[];
}

/**
 * Get a random user with the specified role(s)
 * Used for synthetic authentication in role-based action tokens
 *
 * @param roles Single role or array of roles that the user must have
 * @returns Basic user information with roles or null if no matching user found
 */
export async function getRandomUserWithRole(
  roles: UserRoleTypes | UserRoleTypes[]
): Promise<{ id: string; roles: UserRoleTypes[] } | null> {
  const requiredRoles = Array.isArray(roles) ? roles : [roles];

  // Find users with the required role who aren't ex-employees
  const user = await db.user.findFirst({
    where: {
      roles: {
        hasSome: requiredRoles,
      },
      exEmployee: false,
    },
    select: {
      id: true,
      roles: true,
    },
  });

  return user;
}

/**
 * Update the avatar of a user
 * @param userId The ID of the user to update
 * @param avatar The new avatar URL
 * @returns The updated user object
 */
export async function updateUserAvatar(
  userId: string,
  avatar: string
): Promise<User> {
  const user = await db.user.update({
    where: { id: userId },
    data: {
      discordInfo: {
        update: {
          avatar: avatar,
        },
      },
    },
  });

  return user;
}
