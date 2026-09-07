import { PrismaClient } from "@prisma/client";
import { createRequire } from "module";

const req = createRequire(import.meta.url);

function createClient() {
  if (process.env.NODE_ENV !== "production") {
    try {
      Object.keys(req.cache || {}).forEach((key) => {
        if (key.includes("@prisma") || key.includes(".prisma")) {
          delete req.cache[key];
        }
      });
      const { PrismaClient: FreshClient } = req("@prisma/client");
      return new FreshClient();
    } catch {
      return new PrismaClient();
    }
  }
  return new PrismaClient();
}

function needsRefresh(client) {
  if (!client || !client.productDiscountRule) return true;
  const fields = client._runtimeDataModel?.models?.Settings?.fields;
  if (Array.isArray(fields) && !fields.some((f) => f.name === "confirmationSenderEmail")) {
    return true;
  }
  return false;
}

if (process.env.NODE_ENV !== "production") {
  if (needsRefresh(global.prismaGlobal)) {
    global.prismaGlobal = createClient();
  }
}

const prismaInstance = global.prismaGlobal ?? createClient();

const prisma = new Proxy({}, {
  get(target, prop) {
    if (process.env.NODE_ENV !== "production") {
      if (needsRefresh(global.prismaGlobal)) {
        global.prismaGlobal = createClient();
      }
      return global.prismaGlobal[prop];
    }
    return prismaInstance[prop];
  }
});

export default prisma;
