import { Router, Request, Response } from "express";
import { getAuth } from "@clerk/express";
import { eq, ilike, or, and, count } from "drizzle-orm";
import bcrypt from "bcrypt";
import crypto from "crypto";
import {
  db,
  profilesTable,
  leaderPermissionsTable,
  rsvpsTable,
  attendanceTable,
  membershipRequestsTable,
  checkInRequestsTable,
  eventsTable,
  pendingEmailsTable,
} from "@workspace/db";
import { z } from "zod";
import { messagesTable } from "../db/schema/messages";
import {
  RegisterVisitorBody,
  UpdateMyProfileBody,
} from "@workspace/api-zod";
import { requireLeaderSession } from "../middlewares/requireLeaderSession";

const router = Router();

// GET /profiles/me - Retrieve current logged in Clerk user's profile
router.get("/profiles/me", async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    const clerkId = auth?.userId;

    if (!clerkId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    let profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, clerkId),
    });

    if (!profile) {
      // Extract name, email, phone from Clerk session claims
      const claims = (req as any).auth?.sessionClaims ?? {};
      const firstName = claims?.given_name ?? claims?.first_name ?? "";
      const lastName = claims?.family_name ?? claims?.last_name ?? "";
      const fullName =
        [firstName, lastName].filter(Boolean).join(" ").trim() || "New Member";
      const email: string | null = claims?.email ?? null;
      const phone: string | null = claims?.phone_number ?? null;

      // Unsafe Clerk auto-linking stripped completely.
      // Fresh visitor profile is generated directly for new Clerk signups without verified links.
      const [created] = await db
        .insert(profilesTable)
        .values({
          clerk_id: clerkId,
          full_name: fullName,
          email,
          phone,
          role: "visitor",
          gender: "other",
          age: 0,
          heard_from: "clerk_signup",
        })
        .returning();
      profile = created;
    }

    return res.json(profile);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /profiles/me - Self-update profile (Clerk-auth)
router.patch("/profiles/me", async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    const clerkId = auth?.userId;
    if (!clerkId) return res.status(401).json({ error: "Unauthorized" });
    const parsed = UpdateMyProfileBody.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });
    const existing = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.clerk_id, clerkId),
    });
    if (!existing) return res.status(404).json({ error: "Profile not found" });
    const [updated] = await db
      .update(profilesTable)
      .set(parsed.data)
      .where(eq(profilesTable.clerk_id, clerkId))
      .returning();
    return res.json(updated);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /profiles/me/pin - Check if current leader profile has a PIN set
router.get("/profiles/me/pin", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, req.leaderId!),
    });
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    return res.json({ hasPIN: !!profile.pin_hash });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /profiles/me/pin - Self-change secure PIN with 12-round bcrypt hash
router.patch("/profiles/me/pin", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
    const { current_pin, new_pin } = req.body;
    if (typeof new_pin !== "string" || !/^\d{4,6}$/.test(new_pin)) {
      return res.status(400).json({ error: "New PIN must be 4 to 6 digits" });
    }

    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, req.leaderId!),
    });

    if (!profile) return res.status(404).json({ error: "Profile not found" });

    // Validate current PIN if exists
    if (profile.pin_hash) {
      if (!current_pin) {
        return res.status(400).json({ error: "Current PIN is required to change it" });
      }
      const valid = await bcrypt.compare(current_pin, profile.pin_hash);
      if (!valid) {
        return res.status(401).json({ error: "Current PIN is incorrect" });
      }
    }

    // Atomic update with 12-round bcrypt hashing
    const pinHash = await bcrypt.hash(new_pin, 12);
    await db.update(profilesTable)
      .set({ pin_hash: pinHash })
      .where(eq(profilesTable.id, req.leaderId!));

    return res.json({ success: true, message: "PIN updated successfully" });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /profiles/register/first-timer - Creates unlinked profile & sends verification email
router.post("/profiles/register/first-timer", async (req: Request, res: Response) => {
  try {
    const parsed = RegisterVisitorBody.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });

    const { clerk_id, ...rest } = parsed.data;

    // Generate secure 32-byte hexadecimal link verification token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 72); // 72-hour expiry

    const [profile] = await db
      .insert(profilesTable)
      .values({
        ...rest,
        clerk_id: null,
        role: "visitor",
        link_token: token,
        link_token_expires_at: expiresAt,
        link_token_used: false,
      })
      .returning();

    // Verification link routed through Frontend URL
    const verificationLink = `${process.env.FRONTEND_URL || "http://localhost:5173"}/verify?token=${token}`;
    const emailBody = `
      <div style="font-family: 'Inter', sans-serif; background-color: #0B0F14; color: #E6E8EB; padding: 24px; border-radius: 8px;">
        <h2 style="color: #2A9D8F; font-family: 'Sora', sans-serif;">Verify Your Youth Connect Profile</h2>
        <p>Hi ${profile.full_name},</p>
        <p>Thank you for registering at Youth Connect! To complete your membership and link your login credentials, please click the verification button below:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationLink}" style="background-color: #2A9D8F; color: #E6E8EB; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Verify Account</a>
        </div>
        <p style="font-size: 14px; color: #A0AEC0;">This verification link will expire in 72 hours. If you did not sign up, you can safely ignore this email.</p>
        <p style="font-size: 12px; color: #718096; margin-top: 20px;">Or copy this link: <a href="${verificationLink}" style="color: #2A9D8F;">${verificationLink}</a></p>
      </div>
    `;

    await db.insert(pendingEmailsTable).values({
      to_address: profile.email || "",
      subject: "Verify Your Youth Connect Profile",
      body_html: emailBody,
    });

    return res.status(201).json({ success: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /profiles/verify-link - Verifies token and binds clerk_id to profile (Clerk-auth)
router.post("/profiles/verify-link", async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    const clerkId = auth?.userId;
    if (!clerkId) {
      return res.status(401).json({ error: "Unauthorized: Please log in first to verify your profile link" });
    }

    const { token } = req.body;
    if (typeof token !== "string" || !token) {
      return res.status(400).json({ error: "Token is required" });
    }

    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.link_token, token),
    });

    if (!profile) {
      return res.status(400).json({ error: "Invalid verification link token" });
    }

    if (profile.link_token_used) {
      return res.status(400).json({ error: "This verification link has already been used" });
    }

    if (profile.link_token_expires_at && new Date() > new Date(profile.link_token_expires_at)) {
      return res.status(400).json({ error: "This verification link has expired (72h limit)" });
    }

    // Link clerk_id, mark token as used, and reset token fields
    const [updated] = await db
      .update(profilesTable)
      .set({
        clerk_id: clerkId,
        link_token_used: true,
        link_token: null,
        link_token_expires_at: null,
      })
      .where(eq(profilesTable.id, profile.id))
      .returning();

    // Create automatic pending membership request if not already present
    const existingReq = await db.query.membershipRequestsTable.findFirst({
      where: eq(membershipRequestsTable.profile_id, profile.id),
    });

    if (!existingReq) {
      await db.insert(membershipRequestsTable).values({
        profile_id: profile.id,
        reason: "First-timer link verification profile matching",
        status: "pending",
      });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /profiles/register - Standard immediate Clerk registration (Deprecated in favor of verify-link, but kept for compatibility)
router.post("/profiles/register", async (req: Request, res: Response) => {
  try {
    const parsed = RegisterVisitorBody.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });
    const auth = getAuth(req);
    const { clerk_id, ...rest } = parsed.data;
    const linkedClerkId = auth?.userId ?? clerk_id ?? null;
    const [profile] = await db
      .insert(profilesTable)
      .values({
        ...rest,
        clerk_id: linkedClerkId && linkedClerkId.trim() ? linkedClerkId : null,
        role: "visitor",
      })
      .returning();
    return res.status(201).json(profile);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /profiles - Enforced Paginated profiles listing (protected: leaders and super_admins)
router.get("/profiles", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const role = typeof req.query.role === "string" ? req.query.role : undefined;

    // Enforce pagination boundaries (default page: 1, pageSize: 50, max limit: 100)
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? "50"), 10)));
    const offset = (page - 1) * pageSize;

    let whereClause;
    if (role && search) {
      whereClause = and(
        eq(profilesTable.role, role as any),
        or(
          ilike(profilesTable.full_name, `%${search}%`),
          ilike(profilesTable.phone, `%${search}%`),
        ),
      );
    } else if (role) {
      whereClause = eq(profilesTable.role, role as any);
    } else if (search) {
      whereClause = or(
        ilike(profilesTable.full_name, `%${search}%`),
        ilike(profilesTable.phone, `%${search}%`),
      );
    }

    // 1. Fetch total count
    const [countResult] = await db
      .select({ value: count() })
      .from(profilesTable)
      .where(whereClause);
    const total = countResult?.value ? Number(countResult.value) : 0;

    // 2. Fetch paginated records
    const profiles = await db
      .select({
        id: profilesTable.id,
        full_name: profilesTable.full_name,
        role: profilesTable.role,
        phone: profilesTable.phone,
        email: profilesTable.email,
        school: profilesTable.school,
        parent_phone: profilesTable.parent_phone,
        parent_name: profilesTable.parent_name,
        whatsapp_opt_in: profilesTable.whatsapp_opt_in,
        avatar_url: profilesTable.avatar_url,
        created_at: profilesTable.created_at,
        can_create_events: profilesTable.can_create_events,
        can_view_kpis: profilesTable.can_view_kpis,
        can_view_members: profilesTable.can_view_members,
        can_view_attendance: profilesTable.can_view_attendance,
      })
      .from(profilesTable)
      .where(whereClause)
      .limit(pageSize)
      .offset(offset);

    return res.json(profiles);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /profiles/:id - View profile by ID (protected: leaders)
router.get("/profiles/:id", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, req.params.id as string),
    });
    if (!profile) return res.status(404).json({ error: "Profile not found" });
    return res.json(profile);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /profiles/:id/promote - Promote profile to full member, sends queuing email notification (protected: leaders)
router.post("/profiles/:id/promote", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
    const [updated] = await db
      .update(profilesTable)
      .set({ role: "member" })
      .where(eq(profilesTable.id, req.params.id as string))
      .returning();
    if (!updated) return res.status(404).json({ error: "Profile not found" });
    
    if (updated.email) {
      const hasClerkAccount = !!updated.clerk_id;
      const signUpUrl = `${process.env.FRONTEND_URL ?? "https://youth-connect-tau.vercel.app"}/sign-up`;
      const ctaText = hasClerkAccount
        ? "Log in to see upcoming events, RSVP, and check in on Fridays."
        : `Create your login account to access all member features: ${signUpUrl}`;
      const ctaHtml = hasClerkAccount
        ? `<p>Log in to see upcoming events, RSVP, and check in on Fridays.</p>`
        : `<p><a href="${signUpUrl}" style="background:#2A9D8F;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;margin-top:8px">Create Your Login</a></p><p style="font-size:12px;color:#888;margin-top:4px">Or copy this link: ${signUpUrl}</p>`;

      const emailBody = `
        <div style="font-family: 'Inter', sans-serif; background-color: #0B0F14; color: #E6E8EB; padding: 24px; border-radius: 8px;">
          <h2 style="color: #2A9D8F; font-family: 'Sora', sans-serif;">Welcome to Jeremiah Generation Youth!</h2>
          <p>Hi <strong>${updated.full_name}</strong>,</p>
          <p>You have been approved as a full member of Jeremiah Generation Youth.</p>
          ${ctaHtml}
          <p style="margin-top: 24px; font-weight: bold;">See you on Friday,</p>
          <p style="color: #2A9D8F; font-weight: bold;">Jeremiah Generation Youth Team</p>
        </div>
      `;

      await db.insert(pendingEmailsTable).values({
        to_address: updated.email,
        subject: "Welcome — you are now a member of Jeremiah Generation Youth",
        body_html: emailBody,
      });
    }
    return res.json(updated);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /profiles/:id/revoke-membership - Demotes member back to visitor (protected: leaders)
router.post("/profiles/:id/revoke-membership", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
    const [updated] = await db
      .update(profilesTable)
      .set({ role: "visitor" })
      .where(eq(profilesTable.id, req.params.id as string))
      .returning();
    if (!updated) return res.status(404).json({ error: "Profile not found" });
    return res.json(updated);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /profiles/:id/role - Promotes/demotes leaders & super admins with slot constraints (protected: super_admin only)
router.patch("/profiles/:id/role", requireLeaderSession("super_admin"), async (req: Request, res: Response) => {
  try {
    const { role } = req.body;
    if (!["leader", "super_admin"].includes(role))
      return res.status(400).json({ error: "Invalid role" });
      
    const profileToUpdate = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, req.params.id as string),
    });
    if (!profileToUpdate)
      return res.status(404).json({ error: "Profile not found" });
      
    if (role === "super_admin" && profileToUpdate.role !== "super_admin") {
      const superAdmins = await db.query.profilesTable.findMany({
        where: eq(profilesTable.role, "super_admin"),
      });
      if (superAdmins.length >= 4)
        return res.status(400).json({ error: "All super admin slots filled" });
    }
    
    const [updated] = await db
      .update(profilesTable)
      .set({ role })
      .where(eq(profilesTable.id, req.params.id as string))
      .returning();
      
    if (!updated) return res.status(404).json({ error: "Profile not found" });
    
    if (role === "leader") {
      await db
        .insert(leaderPermissionsTable)
        .values({
          profile_id: req.params.id as string,
          can_create_events: false,
          can_manage_members: false,
          can_view_kpis: false,
          can_approve_membership: false,
        })
        .onConflictDoNothing();
    }
    
    return res.json(updated);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /profiles/:id/permissions - Modify leader permissions directly (protected: super_admin only)
router.patch("/profiles/:id/permissions", requireLeaderSession("super_admin"), async (req: Request, res: Response) => {
  try {
    const PermissionUpdateBody = z.object({
      can_create_events: z.boolean().optional(),
      can_view_kpis: z.boolean().optional(),
      can_view_members: z.boolean().optional(),
      can_view_attendance: z.boolean().optional(),
    });
    const parsed = PermissionUpdateBody.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.flatten() });
      
    const {
      can_create_events,
      can_view_kpis,
      can_view_members,
      can_view_attendance,
    } = parsed.data;
    
    const [updated] = await db
      .update(profilesTable)
      .set({
        ...(can_create_events !== undefined && { can_create_events }),
        ...(can_view_kpis !== undefined && { can_view_kpis }),
        ...(can_view_members !== undefined && { can_view_members }),
        ...(can_view_attendance !== undefined && { can_view_attendance }),
      })
      .where(eq(profilesTable.id, req.params.id as string))
      .returning();
      
    if (!updated) return res.status(404).json({ error: "Profile not found" });
    return res.json(updated);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /profiles/:id - Update member profile info (protected: leaders)
router.patch("/profiles/:id", requireLeaderSession("leader"), async (req: Request, res: Response) => {
  try {
    const { full_name, phone, email, gender, age, school, parent_phone, parent_name, whatsapp_opt_in, avatar_url } = req.body;
    const updateData: Record<string, any> = {};
    if (full_name !== undefined) updateData.full_name = full_name;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (gender !== undefined) updateData.gender = gender;
    if (age !== undefined) updateData.age = age === null ? null : parseInt(String(age), 10);
    if (school !== undefined) updateData.school = school;
    if (parent_phone !== undefined) updateData.parent_phone = parent_phone;
    if (parent_name !== undefined) updateData.parent_name = parent_name;
    if (whatsapp_opt_in !== undefined) updateData.whatsapp_opt_in = whatsapp_opt_in;
    if (avatar_url !== undefined) updateData.avatar_url = avatar_url;

    const [updated] = await db
      .update(profilesTable)
      .set(updateData)
      .where(eq(profilesTable.id, req.params.id as string))
      .returning();

    if (!updated) return res.status(404).json({ error: "Profile not found" });
    return res.json(updated);
  } catch (err) {
    req.log.error(err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /profiles/:id - Hard deletes profile
router.delete("/:id", requireLeaderSession("super_admin"), async (req: Request, res: Response) => {
  try {
    const profile = await db.query.profilesTable.findFirst({
      where: eq(profilesTable.id, req.params.id as string)
    });

    if (!profile) {
      return res.status(404).json({ error: "Profile not found" });
    }

    // Delete the profile (which should cascade or be handled)
    await db.delete(profilesTable).where(eq(profilesTable.id, req.params.id as string));

    if (profile.clerk_id) {
      try {
        if (process.env.CLERK_SECRET_KEY) {
          await fetch(`https://api.clerk.com/v1/users/${profile.clerk_id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
          });
        }
      } catch (clerkErr) {
        req.log.error(
          { clerkErr, orphanedClerkId: profile.clerk_id, profileId: req.params.id },
          "Failed to delete Clerk user in post-delete-clerk-sync"
        );
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    req.log.error(err, "Delete failed");
    return res.status(500).json({ error: "Delete failed" });
  }
});

// ── Avatar Upload Endpoint ───────────────────────────────────────────────────
import multer from "multer";
import { uploadAvatar, FileTooLargeError } from "../storage/avatarUpload";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // Enforce 2MB limit in multer
});

router.post("/profiles/avatar/upload", upload.single("file"), async (req: Request, res: Response) => {
  try {
    let profileId: string | null = null;

    // 1. Try Clerk Auth first
    const auth = getAuth(req);
    if (auth?.userId) {
      const profile = await db.query.profilesTable.findFirst({
        where: eq(profilesTable.clerk_id, auth.userId),
      });
      if (profile) profileId = profile.id;
    }

    // 2. Try leader session fallback
    if (!profileId) {
      const sessionHeader = req.headers["x-leader-session"];
      if (sessionHeader) {
        try {
          const parsed = JSON.parse(sessionHeader as string);
          if (parsed && parsed.profile_id) {
            profileId = parsed.profile_id;
          }
        } catch {}
      }
    }

    if (!profileId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No image file provided" });
    }

    const publicUrl = await uploadAvatar(profileId, file.buffer, file.mimetype);
    return res.json({ url: publicUrl });
  } catch (err: any) {
    if (err instanceof FileTooLargeError || err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File exceeds the 2MB size limit. Please upload a smaller image." });
    }
    req.log.error(err);
    return res.status(500).json({ error: err.message || "Failed to upload avatar" });
  }
});

export default router;
