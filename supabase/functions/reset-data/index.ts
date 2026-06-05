// Supabase Edge Function: reset-data
// Port of the /reset-data route from artifacts/api-server/src/routes/admin.ts.
//
// Wipes all test data. In the Node source, messages lived in a separate
// connection (messagesDb) and were deleted outside the main transaction. Here
// every table lives under one Drizzle `db`, so the messages delete folds into
// the same transaction. Delete order/logic otherwise mirror the source exactly.

import { createApp } from "../_shared/router.ts";
import { db } from "../_shared/db.ts";
import {
  profilesTable,
  leaderPermissionsTable,
  rsvpsTable,
  attendanceTable,
  membershipRequestsTable,
  checkInRequestsTable,
  eventsTable,
  visitorsTable,
  messagesTable,
} from "../_shared/schema.ts";
import { requireRole } from "../_shared/auth.ts";
import { inArray, ne } from "npm:drizzle-orm@0.45.2";

const app = createApp();

// POST /reset-data - Wipe all test data (protected: super_admin)
app.post("/reset-data", requireRole("super_admin"), async (c) => {
  try {
    await db.transaction(async (tx) => {
      // 1. Delete all check-in requests
      await tx.delete(checkInRequestsTable);
      // 2. Delete all attendance
      await tx.delete(attendanceTable);
      // 3. Delete all RSVPs
      await tx.delete(rsvpsTable);
      // 4. Delete all events
      await tx.delete(eventsTable);
      // 5. Delete all membership requests
      await tx.delete(membershipRequestsTable);

      // 6. Delete all leader permissions for non-super_admins
      const nonSuperAdmins = await tx
        .select({ id: profilesTable.id })
        .from(profilesTable)
        .where(ne(profilesTable.role, "super_admin"));
      const nonAdminIds = nonSuperAdmins.map((p) => p.id);

      if (nonAdminIds.length > 0) {
        await tx.delete(leaderPermissionsTable).where(inArray(leaderPermissionsTable.profile_id, nonAdminIds));
      }

      // 7. Delete all visitors
      await tx.delete(visitorsTable);
      // 8. Delete all profiles EXCEPT super admins
      await tx.delete(profilesTable).where(ne(profilesTable.role, "super_admin"));

      // 9. Delete all messages
      await tx.delete(messagesTable);
    });

    return c.json({ success: true, message: "All test data has been successfully wiped." });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

Deno.serve(app.fetch);
