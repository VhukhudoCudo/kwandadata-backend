// One-time script to create the KwandaData admin account directly.
// Run once with: npx tsx scripts/create-admin.ts
// Safe to delete this file afterward.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const email = "admin@kwandadata.co.za";
  const password = "KwandaAdmin@2025";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== "ADMIN") {
      await prisma.user.update({ where: { email }, data: { role: "ADMIN" } });
      console.log(`Existing account found — promoted ${email} to ADMIN.`);
    } else {
      console.log(`${email} already exists and is already ADMIN. Nothing to do.`);
    }
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      firstName: "Kwanda",
      lastName: "Admin",
      email,
      passwordHash,
      phone: "0000000000",
      referralCode: "KWADMIN" + Math.floor(1000 + Math.random() * 9000),
      role: "ADMIN",
      wallet: { create: {} },
    },
  });

  console.log(`Admin account created: ${user.email} (id: ${user.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());