import { Router, type IRouter } from "express";
import healthRouter from "./health";
import profilesRouter from "./profiles";
import eventsRouter from "./events";
import attendanceRouter from "./attendance";
import rsvpsRouter from "./rsvps";
import membershipRouter from "./membership";
import leadersRouter from "./leaders";
import checkinRouter from "./checkin";
import qrcodesRouter from "./qrcodes";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(profilesRouter);
router.use(eventsRouter);
router.use(attendanceRouter);
router.use(rsvpsRouter);
router.use(membershipRouter);
router.use(leadersRouter);
router.use(checkinRouter);
router.use(qrcodesRouter);
router.use(dashboardRouter);

export default router;
