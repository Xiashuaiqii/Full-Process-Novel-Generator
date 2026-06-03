import { prisma } from "@/lib/prisma";

export async function getOrCreateLocalUser() {
  const existing = await prisma.localUser.findFirst({
    orderBy: { createdAt: "asc" }
  });

  if (existing) {
    return existing;
  }

  return prisma.localUser.create({
    data: {
      id: "local-user",
      name: "Local User"
    }
  });
}
