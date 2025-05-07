import {Leave} from '@prisma/client';
import {db} from '.';

/**
 * Get leaves within a date range for a specific user or all users
 *
 * @param startDate The start of the date range
 * @param endDate The end of the date range
 * @param userId Optional user ID to filter leaves
 * @returns Array of leave requests that fall within the date range
 */
export const getLeavesInDateRange = async (
  startDate: Date,
  endDate: Date,
  userId?: string
): Promise<Leave[]> => {
  // First, fetch leaves with appropriate filters
  const leaves = await db.leave.findMany({
    where: {
      // Filter by user if provided
      ...(userId ? {userId} : {}),
      // reviewed: undefined,
      // For status, include both pending leaves (reviewed is missing or null)
      // and leaves that aren't explicitly cancelled
      OR: [
        {reviewed: null}, // This covers cases where reviewed is null
        {NOT: {reviewed: {isSet: true}}}, // Use equals for missing fields
      ],
    },
    include: {
      user: {
        select: {
          name: true,
          orgEmail: true,
        },
      },
    },
  });

  // Then filter for dates in the range (application-side filtering)
  return leaves.filter(leave => {
    return leave.dates.some(date => {
      const leaveDate = new Date(date);
      return leaveDate >= startDate && leaveDate <= endDate;
    });
  });
};

/**
 * Create a new leave request for a user
 *
 * @param userId The ID of the user requesting leave
 * @param dates Array of dates for the leave request
 * @param reason Optional reason for the leave request
 * @returns The created leave request
 */
export const createLeaveRequest = async (
  userId: string,
  dates: Date[],
  reason?: string
): Promise<Leave> => {
  return db.leave.create({
    data: {
      userId,
      dates,
      reason,
      requestDate: new Date(), // Add request date
      // No reviewed field as it starts as pending
    },
    include: {
      user: {
        select: {
          name: true,
          orgEmail: true,
        },
      },
    },
  });
};

/**
 * Cancel a leave request for a user on a specific date
 *
 * @param userId The ID of the user
 * @param date The date of the leave to cancel
 * @returns The updated leave request marked as cancelled, or null if no matching leave found
 */
export const cancelLeaveRequest = async (userId: string, date: Date): Promise<Leave | null> => {
  // First, find the active leave request for this date
  const leaves = await db.leave.findMany({
    where: {
      userId,
      dates: {
        has: date,
      },
      // Only include pending or approved leaves, not cancelled
      OR: [
        {reviewed: null}, // Pending leaves
        {NOT: {reviewed: {isSet: true}}}, // This covers cases where reviewed is null
        {reviewed: {isNot: {approved: false}}}, // Approved leaves
      ],
    },
    take: 1,
  });

  // If no leave found, return null
  if (leaves.length === 0) {
    return null;
  }

  // Cancel the found leave
  return db.leave.update({
    where: {id: leaves[0].id},
    data: {
      // Mark as not approved for cancellation
      reviewed: {
        approved: false,
        by: userId, // Special marker for self-cancellation
        date: new Date(),
      },
    },
    include: {
      user: {
        select: {
          name: true,
          orgEmail: true,
        },
      },
    },
  });
};

/**
 * Approve or reject a leave request
 *
 * @param leaveId The ID of the leave request
 * @param approved Whether to approve or reject the leave
 * @param adminId The ID of the admin performing the action
 * @returns The updated leave request or null if not found
 */
export const reviewLeaveRequest = async (
  leaveId: string,
  approved: boolean,
  adminId: string
): Promise<Leave | null> => {
  return db.leave.update({
    where: {id: leaveId},
    data: {
      reviewed: {
        approved,
        by: adminId,
        date: new Date(),
      },
    },
    include: {
      user: {
        select: {
          name: true,
          orgEmail: true,
        },
      },
    },
  });
};

/**
 * Get a leave request by ID
 *
 * @param leaveId The ID of the leave request
 * @returns The leave request or null if not found
 */
export const getLeaveById = async (leaveId: string): Promise<Leave | null> => {
  return db.leave.findUnique({
    where: {id: leaveId},
    include: {
      user: {
        select: {
          name: true,
          orgEmail: true,
        },
      },
    },
  });
};
