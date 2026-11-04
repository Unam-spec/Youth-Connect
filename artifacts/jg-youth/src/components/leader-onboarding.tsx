import { useEffect } from "react";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { getLeaderSession } from "@/lib/auth";

// Bumped to v2 when the tour was rewritten for kiosk mode, push notifications,
// birthdays and PIN accounts, and to v3 for the one group check-in message,
// leader nudges, tap-to-enlarge photos and staying signed in. Leaders who
// finished an older version see the new one once.
const TOUR_SEEN_KEY = "jg_youth_dashboard_tour_seen_v3";

const TOUR_STEPS: DriveStep[] = [
  {
    element: "body",
    popover: {
      title: "Welcome to the Leader Dashboard! 👋",
      description:
        "What's new: <strong>one group check-in message</strong> you send in a tap, <strong>notifications</strong> telling you when messages need to go out, <strong>birthday notifications</strong> for everyone, and <strong>tap any profile photo</strong> to see it bigger. You also stay signed in now, and the app reopens where you left off. Let's take a quick tour.",
      side: "bottom",
    },
  },
  {
    element: "#tour-nav-sidebar",
    popover: {
      title: "Navigation Menu",
      description:
        "Here you can access Analytics, Messaging, and more.<br/><br/><strong>📱 Mobile Users:</strong> You can SWIPE or SCROLL this bar horizontally to see all the options!",
      side: "right",
      align: "start",
    },
  },
  {
    element: "#tour-nav-session",
    popover: {
      title: "Live Session",
      description:
        "The default view. See today's live check-ins, approve pending kiosk check-ins, and set the weekly check-in schedule.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "#tour-kiosk-button",
    popover: {
      title: "Kiosk Mode 🆕",
      description:
        "Turn a shared phone or tablet into a self-service check-in station. Members check in with their name and PIN, and newcomers can register on the spot — every kiosk check-in lands in your approval queue on the Session tab. The shared kiosk PIN is managed there too.",
      side: "bottom",
      align: "end",
    },
  },
  {
    element: "#tour-nav-members",
    popover: {
      title: "Manage Members",
      description:
        "View the full directory, edit member details, manage PIN accounts, review membership requests, and see upcoming birthdays. 🎂<br/><br/>On someone's birthday, every member and leader gets a notification. Tap any profile photo to enlarge it.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "#tour-nav-events",
    popover: {
      title: "Events",
      description:
        "Create and manage upcoming youth events, view RSVPs, and send a push notification to members straight from an event card. 🔔",
      side: "right",
      align: "start",
    },
  },
  {
    element: "#tour-nav-follow-ups",
    popover: {
      title: "Messaging 🆕",
      description:
        "<strong>One check-in message for the group:</strong> tap <em>Send to group</em> and post it in the WhatsApp group. You'll get a notification an hour before check-in closes.<br/><br/>Below it are the <strong>follow-ups</strong> for members who've been away for weeks. Every leader is notified when new ones need sending, and again at midday while some are still waiting.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "#tour-nav-templates",
    popover: {
      title: "Message Templates",
      description:
        "Customize the text of your automated WhatsApp follow-up messages.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "#tour-nav-manage",
    popover: {
      title: "Settings / Manage",
      description:
        "Super Admins can manage leader permissions and system settings here.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "#tour-nav-analytics",
    popover: {
      title: "Analytics",
      description:
        "View attendance charts, member statistics over time, and the at-risk members list — sorted by who's been away the longest.",
      side: "right",
      align: "start",
    },
  },
  {
    element: "#tour-main-content",
    popover: {
      title: "Your Workspace",
      description:
        "This is your main active area. When a notification says messages are waiting, tap it to land straight on Messaging. That's the tour!",
      side: "top",
      align: "start",
    },
  },
];

export function LeaderOnboarding() {
  // Reduce the session to a stable boolean: getLeaderSession() returns a new
  // object every render, and depending on it made every dashboard re-render
  // (query refetch, polling) destroy and restart the tour from step 1.
  const isLoggedIn = Boolean(getLeaderSession());

  useEffect(() => {
    // Only show to logged in leaders
    if (!isLoggedIn) return;

    // Check if they've already seen the tour on this device
    const hasSeenTour = localStorage.getItem(TOUR_SEEN_KEY);
    if (hasSeenTour === "true") return;

    const tour = driver({
      showProgress: true,
      animate: true,
      steps: [],
      onDestroyStarted: () => {
        if (!tour.hasNextStep() || confirm("Are you sure you want to skip the tour?")) {
          tour.destroy();
          localStorage.setItem(TOUR_SEEN_KEY, "true");
        }
      },
    });

    // Small delay to ensure DOM is fully painted. Steps whose target isn't on
    // this page (role-gated nav items, the Kiosk button outside /dashboard)
    // are dropped so the tour never shows a popover pointing at nothing.
    const timer = setTimeout(() => {
      tour.setSteps(
        TOUR_STEPS.filter(
          (step) =>
            typeof step.element !== "string" ||
            document.querySelector(step.element),
        ),
      );
      tour.drive();
    }, 500);

    return () => {
      clearTimeout(timer);
      tour.destroy();
    };
  }, [isLoggedIn]);

  return null;
}
