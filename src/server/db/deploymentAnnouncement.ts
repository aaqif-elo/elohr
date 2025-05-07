import {db} from '.';
import {Prisma} from '@prisma/client';

export enum COMMON_ERRORS {
  DUPLICATE_ENTRY = 'Duplicate entry detected.',
}

export const addAnnouncement = async (
  deploymentAnnouncement: Prisma.DeploymentAnnouncementCreateInput
) => {
  try {
    return await db.deploymentAnnouncement.create({
      data: deploymentAnnouncement,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        // Handle unique constraint violation
        throw new Error(COMMON_ERRORS.DUPLICATE_ENTRY);
      }
    }
    throw error;
  }
};
