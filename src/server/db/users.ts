import type { Attendance, User } from "@prisma/client";
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

// All current (non-ex) employees with their embedded contracts, for reporting.
export const getActiveEmployees = (): Promise<User[]> =>
  db.user.findMany({ where: { exEmployee: false } });


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
                    { $gte: ["$date", { $toDate: start.toISOString() }] },
                    { $lte: ["$date", { $toDate: end.toISOString() }] },
                  ],
                },
              },
            },
            // 3. Project and convert date and ObjectId fields.
            {
              $project: {
                // Convert the attendance document's own _id and user reference to strings.
                _id: { $toString: "$_id" },
                user: { $toString: "$user" },
                date: {
                  $dateToString: {
                    date: "$date",
                    format: "%Y-%m-%dT%H:%M:%S.%LZ",
                  },
                },
                // Convert dates in the workSegments array.
                workSegments: {
                  $map: {
                    input: { $ifNull: ["$workSegments", []] },
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
                    },
                  },
                },
                totalWork: "$totalWork",
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
