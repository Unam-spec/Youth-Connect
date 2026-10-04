declare namespace Express {
  interface Request {
    leaderId?: string;
    leaderRole?: string;
    worshipAccount?: import("@workspace/db").WorshipAccount;
    worshipToken?: string;
  }
}
