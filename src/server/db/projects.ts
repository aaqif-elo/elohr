import type { Project, User, WorkChannel } from "@prisma/client";
import { db } from ".";

type ProjectWithChannels = Project & {
  channels: WorkChannel[];
  manager: User;
};

// Projects are always referenced by their (case-insensitive) name — admins
// interact via Discord and never see the underlying database id.
const findProjectByName = (
  name: string,
): Promise<ProjectWithChannels | null> =>
  db.project.findFirst({
    where: { name: { equals: name.trim(), mode: "insensitive" } },
    include: { channels: true, manager: true },
  });

export const listProjects = (): Promise<ProjectWithChannels[]> =>
  db.project.findMany({
    include: { channels: true, manager: true },
    orderBy: { name: "asc" },
  });

// Public, name-based lookup for callers that need the resolved project record.
export const getProjectByName = (
  name: string,
): Promise<ProjectWithChannels | null> => findProjectByName(name);

/**
 * Resolve the project a Discord voice channel belongs to, or null if the
 * channel isn't assigned to any project. Used by the voice hook to decide
 * whether a voice state change should be tracked.
 */
export const getProjectByChannelId = async (
  channelId: string,
): Promise<Project | null> => {
  const channel = await db.workChannel.findUnique({
    where: { channelId },
    include: { project: true },
  });
  return channel?.project ?? null;
};

type CreateProjectResult =
  | { ok: false; message: string }
  | { ok: true; project: Project };

// The creator becomes the project's initial manager; an admin can reassign it
// later via `setProjectManager`.
export const createProject = async (
  name: string,
  managerId: string,
): Promise<CreateProjectResult> => {
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, message: "Project name can't be empty." };
  }

  const existing = await db.project.findFirst({
    where: { name: { equals: trimmed, mode: "insensitive" } },
  });
  if (existing) {
    return { ok: false, message: `A project named **${existing.name}** already exists.` };
  }

  const project = await db.project.create({
    data: { name: trimmed, managerId },
  });
  return { ok: true, project };
};

type SetManagerResult =
  | { ok: false; message: string }
  | { ok: true; projectName: string; managerName: string };

// Reassign a project's manager. Caller is responsible for verifying the new
// manager is an eligible (admin) user before calling.
export const setProjectManager = async (
  projectName: string,
  manager: User,
): Promise<SetManagerResult> => {
  const project = await findProjectByName(projectName);
  if (!project) {
    return { ok: false, message: `No project named \`${projectName}\`.` };
  }

  if (project.managerId === manager.id) {
    return {
      ok: false,
      message: `**${manager.name}** already manages **${project.name}**.`,
    };
  }

  await db.project.update({
    where: { id: project.id },
    data: { managerId: manager.id },
  });
  return { ok: true, projectName: project.name, managerName: manager.name };
};

type DeleteProjectResult =
  | { ok: false; message: string }
  | { ok: true; project: Project; removedChannels: number };

export const deleteProject = async (
  name: string,
): Promise<DeleteProjectResult> => {
  const project = await findProjectByName(name);
  if (!project) {
    return { ok: false, message: `No project named \`${name}\`.` };
  }

  const removedChannels = await db.workChannel.deleteMany({
    where: { projectId: project.id },
  });
  await db.project.delete({ where: { id: project.id } });

  return { ok: true, project, removedChannels: removedChannels.count };
};

type AssignChannelResult =
  | { ok: false; message: string }
  | {
      ok: true;
      projectName: string;
      channelName: string;
      previousProjectName?: string;
    };

/**
 * Assign a voice channel to a project. If the channel is already assigned to a
 * different project it is moved; if it's already on this project the call is a
 * no-op reported back to the caller.
 */
export const assignChannelToProject = async (
  projectName: string,
  channelId: string,
  channelName: string,
): Promise<AssignChannelResult> => {
  const project = await findProjectByName(projectName);
  if (!project) {
    return { ok: false, message: `No project named \`${projectName}\`.` };
  }

  const existing = await db.workChannel.findUnique({
    where: { channelId },
    include: { project: true },
  });

  if (existing) {
    if (existing.projectId === project.id) {
      return {
        ok: false,
        message: `**${channelName}** is already assigned to **${project.name}**.`,
      };
    }
    await db.workChannel.update({
      where: { channelId },
      data: { projectId: project.id, channelName },
    });
    return {
      ok: true,
      projectName: project.name,
      channelName,
      previousProjectName: existing.project.name,
    };
  }

  await db.workChannel.create({
    data: { channelId, channelName, projectId: project.id },
  });
  return { ok: true, projectName: project.name, channelName };
};

type UnassignChannelResult =
  | { ok: false; message: string }
  | { ok: true; channelName: string; projectName: string };

/**
 * Unassign a channel identified by its Discord ID or (case-insensitive) name.
 * Accepting the name lets admins remove channels that have since been deleted.
 */
export const unassignChannel = async (
  channelIdOrName: string,
): Promise<UnassignChannelResult> => {
  const query = channelIdOrName.trim();
  const channel = await db.workChannel.findFirst({
    where: {
      OR: [
        { channelId: query },
        { channelName: { equals: query, mode: "insensitive" } },
      ],
    },
    include: { project: true },
  });

  if (!channel) {
    return { ok: false, message: `No assigned channel found matching \`${channelIdOrName}\`.` };
  }

  await db.workChannel.delete({ where: { id: channel.id } });
  return {
    ok: true,
    channelName: channel.channelName,
    projectName: channel.project.name,
  };
};
