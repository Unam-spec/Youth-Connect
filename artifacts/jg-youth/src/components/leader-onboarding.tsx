import { useEffect } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { getLeaderSession } from "@/lib/auth";

export function LeaderOnboarding() {
  const session = getLeaderSession();

  useEffect(() => {
    // Only show to logged in leaders
    if (!session) return;

    // Check if they've already seen the tour on this device
    const hasSeenTour = localStorage.getItem("jg_youth_dashboard_tour_seen");
    if (hasSeenTour === "true") return;

    const tour = driver({
      showProgress: true,
      animate: true,
      steps: [
        {
          element: "body",
          popover: {
            title: "Welcome to the Leader Dashboard! 👋",
            description:
              "We've added some powerful new features to help you manage JG Youth. Let's take a quick 3-step tour.",
            side: "bottom",
          },
        },
        {
          element: "#tour-nav-sidebar",
          popover: {
            title: "Navigation Menu",
            description:
              "Here you can access Analytics, Follow-ups, and more.<br/><br/><strong>📱 Mobile Users:</strong> You can SWIPE or SCROLL this bar horizontally to see all the options!",
            side: "right",
            align: "start",
          },
        },
        {
          element: "#tour-nav-session",
          popover: {
            title: "Live Session",
            description:
              "The default view. See today's live check-ins and approve pending first-timers.",
            side: "right",
            align: "start",
          },
        },
        {
          element: "#tour-nav-members",
          popover: {
            title: "Manage Members",
            description:
              "View the full directory, edit member details, and manage PIN accounts.",
            side: "right",
            align: "start",
          },
        },
        {
          element: "#tour-nav-events",
          popover: {
            title: "Events",
            description:
              "Create and manage upcoming youth events and view RSVPs.",
            side: "right",
            align: "start",
          },
        },
        {
          element: "#tour-nav-follow-ups",
          popover: {
            title: "Follow-ups",
            description:
              "Send automated WhatsApp messages to members who haven't attended in a while.",
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
              "View attendance charts and member statistics over time.",
            side: "right",
            align: "start",
          },
        },
        {
          element: "#tour-main-content",
          popover: {
            title: "Your Workspace",
            description:
              "This is your main active area. Head over to the Follow-ups tab to see the new automated queue in action!",
            side: "top",
            align: "start",
          },
        },
      ],
      onDestroyStarted: () => {
        if (!tour.hasNextStep() || confirm("Are you sure you want to skip the tour?")) {
          tour.destroy();
          localStorage.setItem("jg_youth_dashboard_tour_seen", "true");
        }
      },
    });

    // Small delay to ensure DOM is fully painted
    const timer = setTimeout(() => {
      tour.drive();
    }, 500);

    return () => {
      clearTimeout(timer);
      tour.destroy();
    };
  }, [session]);

  return null;
}
