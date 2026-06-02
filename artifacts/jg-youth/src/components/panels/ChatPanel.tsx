import { useRef, useEffect, useState } from "react";
import { MessageSquare, Trash2, CornerDownRight, MoreVertical, X } from "lucide-react";
import { RoleBadge } from "./shared";
import { useToast } from "@/hooks/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface ChatMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_role: "super_admin" | "leader" | "member" | "visitor";
  content: string;
  created_at: string;
  replyToId?: string | null;
  deletedForEveryone?: boolean;
  deletedForSender?: boolean;
}

interface ChatPanelProps {
  sessionRole: string;
  sessionProfileId: string;
  activeTab: string;
  isSignedIn: boolean;
  getToken: () => Promise<string | null>;
}

const MessageBubble = ({ 
  msg, 
  messages, 
  isMe, 
  sessionRole, 
  onReply, 
  onDeleteForMe, 
  onDeleteForEveryone 
}: {
  msg: ChatMessage;
  messages: ChatMessage[];
  isMe: boolean;
  sessionRole: string;
  onReply: (m: ChatMessage) => void;
  onDeleteForMe: (id: string) => void;
  onDeleteForEveryone: (id: string) => void;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showHover, setShowHover] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchStart = () => {
    pressTimer.current = setTimeout(() => setMenuOpen(true), 500);
  };
  const handleTouchEnd = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  };
  if (msg.deletedForEveryone) {
    return (
      <div className={`flex items-start gap-2.5 max-w-[85%] ${isMe ? "ml-auto flex-row-reverse" : "mr-auto"}`}>
        <div className="px-4 py-2 text-sm italic text-muted-foreground/60">
          This message was deleted
        </div>
      </div>
    );
  }

  const parentMsg = msg.replyToId ? messages.find(m => m.id === msg.replyToId) : null;
  const canDeleteForEveryone = isMe || ["super_admin", "leader"].includes(sessionRole);
  const msgDate = new Date(msg.created_at);
  const timeStr = isNaN(msgDate.getTime()) ? "" : msgDate.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });

  return (
    <div 
      id={`msg-${msg.id}`}
      className={`flex items-start gap-2.5 max-w-[85%] relative group ${isMe ? "ml-auto flex-row-reverse" : "mr-auto"}`}
      onMouseEnter={() => setShowHover(true)}
      onMouseLeave={() => setShowHover(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
    >
      {!isMe && (
        <div className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-teal-300 bg-teal-500/10 border border-teal-500/20 shrink-0">
          {msg.sender_name?.charAt(0)?.toUpperCase() ?? "?"}
        </div>
      )}
      <div className="space-y-1">
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm shadow-md border relative ${
            isMe
              ? "bg-gradient-to-br from-teal-600 to-cyan-600 text-white border-teal-500/20 rounded-tr-none"
              : "bg-slate-800/90 text-slate-100 border-slate-700/60 rounded-tl-none"
          }`}
        >
          {parentMsg && (
            <div 
              className="mb-2 pl-2 border-l-2 border-white/40 cursor-pointer hover:opacity-80 transition-opacity bg-black/10 rounded-r py-1 px-2"
              onClick={() => {
                const el = document.getElementById(`msg-${parentMsg.id}`);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
            >
              <div className="text-[10px] font-bold text-white/70 mb-0.5 flex items-center gap-1">
                <CornerDownRight className="w-3 h-3" />
                {parentMsg.sender_name}
              </div>
              <p className="text-xs text-white/90 truncate opacity-80 max-w-[200px]">
                {parentMsg.deletedForEveryone ? "Original message deleted" : parentMsg.content}
              </p>
            </div>
          )}
          <p className="leading-relaxed break-words whitespace-pre-wrap">{msg.content}</p>
        </div>
        <div
          className={`flex items-center gap-1.5 text-[10px] text-muted-foreground px-1 ${
            isMe ? "justify-end" : "justify-start"
          }`}
        >
          {!isMe && <span className="font-semibold text-slate-300">{msg.sender_name}</span>}
          <RoleBadge role={msg.sender_role} />
          <span>{timeStr}</span>
        </div>
      </div>

      <div className={`absolute top-0 ${isMe ? "-left-[4.5rem]" : "-right-[4.5rem]"} flex items-center gap-0.5 transition-opacity duration-200 ${showHover || menuOpen ? "opacity-100" : "opacity-0 md:opacity-0"}`}>
        <button 
          className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 md:block hidden"
          onClick={() => onReply(msg)}
        >
          <CornerDownRight className="w-4 h-4" />
        </button>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 md:block hidden">
              <MoreVertical className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={isMe ? "end" : "start"}>
            <DropdownMenuItem onClick={() => onReply(msg)}>Reply</DropdownMenuItem>
            {isMe && <DropdownMenuItem onClick={() => onDeleteForMe(msg.id)}>Delete for me</DropdownMenuItem>}
            {canDeleteForEveryone && (
              <DropdownMenuItem className="text-red-500 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950/50" onClick={() => onDeleteForEveryone(msg.id)}>
                Delete for everyone
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};

export function ChatPanel({
  sessionRole,
  sessionProfileId,
  activeTab,
  isSignedIn,
  getToken,
}: ChatPanelProps) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isSendingChatMessage, setIsSendingChatMessage] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [chatConnectionStatus, setChatConnectionStatus] = useState<
    "connecting" | "connected" | "polling" | "error"
  >("connecting");
  const chatMessagesContainerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (activeTab !== "channel") return;

    let isMounted = true;
    let eventSource: EventSource | null = null;
    let pollingInterval: ReturnType<typeof setInterval> | null = null;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;

    async function fetchHistory() {
      try {
        const token = isSignedIn ? await getToken() : "";
        const leaderSessionStr = localStorage.getItem("jg_leader_session") ?? "";
        const apiBase = import.meta.env.VITE_API_URL || "";
        const response = await fetch(`${apiBase}/api/messages`, {
          headers: {
            "x-leader-session": leaderSessionStr,
            ...(token && { Authorization: `Bearer ${token}` }),
          },
        });
        if (response.ok && isMounted) {
          const data = await response.json();
          if (Array.isArray(data)) {
            // Map snake_case to camelCase in case the API returns raw DB rows
            const mapped = data.map(m => ({
              ...m,
              deletedForEveryone: m.deletedForEveryone ?? m.deleted_for_everyone ?? false,
              deletedForSender: m.deletedForSender ?? m.deleted_for_sender ?? false,
              replyToId: m.replyToId ?? m.reply_to_id ?? null
            }));
            setChatMessages(mapped);
          } else {
            console.error("API returned non-array:", data);
            setChatMessages([]);
          }
          setTimeout(() => {
            if (chatMessagesContainerRef.current) {
              chatMessagesContainerRef.current.scrollTop =
                chatMessagesContainerRef.current.scrollHeight;
            }
          }, 100);
        } else if (!response.ok) {
          console.error("Failed to fetch history, status:", response.status);
        }
      } catch (err) {
        console.error("Failed to fetch chat history:", err);
      }
    }

    async function connectSSE() {
      setChatConnectionStatus("connecting");
      try {
        const token = isSignedIn ? await getToken() : "";
        const leaderSessionStr = localStorage.getItem("jg_leader_session") ?? "";
        const apiBase = import.meta.env.VITE_API_URL || "";
        const url = `${apiBase}/api/messages/stream?token=${encodeURIComponent(
          token || ""
        )}&leader_session=${encodeURIComponent(leaderSessionStr)}`;

        eventSource = new EventSource(url);

        // If the stream neither opens nor errors within a few seconds (e.g. it
        // hangs behind a proxy), fall back to polling so history still loads.
        connectTimer = setTimeout(() => {
          if (isMounted && eventSource && eventSource.readyState !== EventSource.OPEN) {
            console.warn("SSE connect timeout — falling back to polling");
            cleanupSSE();
            startPolling();
          }
        }, 4000);

        eventSource.onopen = () => {
          if (connectTimer) {
            clearTimeout(connectTimer);
            connectTimer = null;
          }
          if (isMounted) setChatConnectionStatus("connected");
        };

        eventSource.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const parsed = JSON.parse(event.data);
            const newMsg = {
              ...parsed,
              deletedForEveryone: parsed.deletedForEveryone ?? parsed.deleted_for_everyone ?? false,
              deletedForSender: parsed.deletedForSender ?? parsed.deleted_for_sender ?? false,
              replyToId: parsed.replyToId ?? parsed.reply_to_id ?? null
            };
            setChatMessages((prev) => {
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              const next = [...prev, newMsg];
              setTimeout(() => {
                if (chatMessagesContainerRef.current) {
                  chatMessagesContainerRef.current.scrollTop =
                    chatMessagesContainerRef.current.scrollHeight;
                }
              }, 50);
              return next;
            });
          } catch (err) {
            console.error("Failed to parse incoming message:", err);
          }
        };

        eventSource.addEventListener("delete", (event: any) => {
          if (!isMounted) return;
          try {
            const { id } = JSON.parse(event.data);
            setChatMessages((prev) => prev.filter((m) => m.id !== id));
          } catch (err) {
            console.error("Failed to parse delete event:", err);
          }
        });

        eventSource.addEventListener("update", (event: any) => {
          if (!isMounted) return;
          try {
            const parsed = JSON.parse(event.data);
            const updatedMsg = {
              ...parsed,
              deletedForEveryone: parsed.deletedForEveryone ?? parsed.deleted_for_everyone ?? false,
              deletedForSender: parsed.deletedForSender ?? parsed.deleted_for_sender ?? false,
              replyToId: parsed.replyToId ?? parsed.reply_to_id ?? null
            };
            setChatMessages((prev) => prev.map((m) => m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m));
          } catch (err) {
            console.error("Failed to parse update event:", err);
          }
        });

        eventSource.onerror = () => {
          if (!isMounted) return;
          if (connectTimer) {
            clearTimeout(connectTimer);
            connectTimer = null;
          }
          console.warn("SSE connection error — falling back to polling");
          cleanupSSE();
          startPolling();
        };
      } catch (err) {
        console.error("Failed to initialize SSE:", err);
        startPolling();
      }
    }

    function startPolling() {
      if (!isMounted) return;
      if (pollingInterval) return; // already polling — don't stack intervals
      setChatConnectionStatus("polling");
      fetchHistory();
      pollingInterval = setInterval(fetchHistory, 5000);
    }

    function cleanupSSE() {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    }

    fetchHistory().then(() => {
      if (isMounted) connectSSE();
    });

    return () => {
      isMounted = false;
      cleanupSSE();
      if (connectTimer) clearTimeout(connectTimer);
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, [activeTab, isSignedIn, getToken]);

  async function handleSendChatMessage(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!chatInput.trim() || isSendingChatMessage) return;

    const content = chatInput.trim();
    const reply_to_id = replyingTo?.id || null;
    
    setChatInput("");
    setReplyingTo(null);
    setIsSendingChatMessage(true);

    try {
      const token = isSignedIn ? await getToken() : "";
      const leaderSessionStr = localStorage.getItem("jg_leader_session") ?? "";
      const apiBase = import.meta.env.VITE_API_URL || "";
      const response = await fetch(`${apiBase}/api/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-leader-session": leaderSessionStr,
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ content, reply_to_id }),
      });

      if (!response.ok) throw new Error("Failed to send message");

      // Optimistically append the created message so the sender sees it
      // immediately, instead of waiting for the SSE echo (which may be down).
      const created = await response.json();
      const mapped: ChatMessage = {
        ...created,
        deletedForEveryone: created.deletedForEveryone ?? created.deleted_for_everyone ?? false,
        deletedForSender: created.deletedForSender ?? created.deleted_for_sender ?? false,
        replyToId: created.replyToId ?? created.reply_to_id ?? null,
      };
      setChatMessages((prev) =>
        prev.some((m) => m.id === mapped.id) ? prev : [...prev, mapped],
      );

      setTimeout(() => {
        if (chatMessagesContainerRef.current) {
          chatMessagesContainerRef.current.scrollTop =
            chatMessagesContainerRef.current.scrollHeight;
        }
      }, 50);
    } catch {
      toast({
        title: "Message failed",
        description: "Unable to send chat message. Please try again.",
        variant: "destructive",
      });
      setChatInput(content);
      if (reply_to_id) setReplyingTo(replyingTo);
    } finally {
      setIsSendingChatMessage(false);
    }
  }

  async function handleDeleteForMe(messageId: string) {
    setChatMessages(prev => prev.map(msg => msg.id === messageId ? { ...msg, deletedForSender: true } : msg));
    try {
      const token = isSignedIn ? await getToken() : "";
      const leaderSessionStr = localStorage.getItem("jg_leader_session") ?? "";
      const apiBase = import.meta.env.VITE_API_URL || "";
      const response = await fetch(`${apiBase}/api/messages/${messageId}/delete-for-me`, {
        method: "PATCH",
        headers: {
          "x-leader-session": leaderSessionStr,
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      });
      if (!response.ok) throw new Error();
      toast({ title: "Message deleted for you" });
    } catch {
      toast({ title: "Failed to delete message", variant: "destructive" });
      // Revert optimistic update
      setChatMessages(prev => prev.map(msg => msg.id === messageId ? { ...msg, deletedForSender: false } : msg));
    }
  }

  async function handleDeleteForEveryone(messageId: string) {
    try {
      const token = isSignedIn ? await getToken() : "";
      const leaderSessionStr = localStorage.getItem("jg_leader_session") ?? "";
      const apiBase = import.meta.env.VITE_API_URL || "";
      const response = await fetch(`${apiBase}/api/messages/${messageId}/delete-for-everyone`, {
        method: "PATCH",
        headers: {
          "x-leader-session": leaderSessionStr,
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      });
      if (!response.ok) throw new Error();
      toast({ title: "Message deleted for everyone" });
    } catch {
      toast({ title: "Failed to delete message", variant: "destructive" });
    }
  }

  useEffect(() => {
    if (chatMessagesContainerRef.current) {
      chatMessagesContainerRef.current.scrollTop = chatMessagesContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const visibleMessages = chatMessages.filter(msg => !(msg.deletedForSender && msg.sender_id === sessionProfileId));

  return (
    <div className="border border-border/50 rounded-2xl bg-card/40 backdrop-blur-sm overflow-hidden flex flex-col h-[650px] shadow-2xl relative">
      <div className="p-4 border-b border-border/50 flex items-center justify-between bg-muted/10 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-full bg-teal-500/10 flex items-center justify-center border border-teal-500/20 shadow-inner">
            <MessageSquare className="h-4.5 w-4.5 text-teal-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Co-ordination Channel</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">Private channel for leaders & admins</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-950/40 border border-slate-800/80 text-[10px] font-semibold tracking-wider uppercase">
          <span className="relative flex h-2 w-2">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
              chatConnectionStatus === "connected" ? "bg-emerald-400" :
              chatConnectionStatus === "connecting" ? "bg-amber-400" :
              chatConnectionStatus === "polling" ? "bg-cyan-400" : "bg-destructive"
            }`} />
            <span className={`relative inline-flex rounded-full h-2 w-2 ${
              chatConnectionStatus === "connected" ? "bg-emerald-400" :
              chatConnectionStatus === "connecting" ? "bg-amber-400" :
              chatConnectionStatus === "polling" ? "bg-cyan-400" : "bg-destructive"
            }`} />
          </span>
          <span className={
            chatConnectionStatus === "connected" ? "text-emerald-400" :
            chatConnectionStatus === "connecting" ? "text-amber-400" :
            chatConnectionStatus === "polling" ? "text-cyan-400" : "text-destructive"
          }>
            {chatConnectionStatus === "connected" ? "Live Feed" :
             chatConnectionStatus === "connecting" ? "Syncing..." :
             chatConnectionStatus === "polling" ? "Polling (SSE Fail)" : "Offline"}
          </span>
        </div>
      </div>
      <div
        ref={chatMessagesContainerRef}
        className="flex-grow overflow-y-auto p-4 space-y-4 bg-slate-950/20 scrollbar-thin scrollbar-thumb-slate-800"
      >
        {visibleMessages.length > 0 ? (
          visibleMessages.map((msg) => (
            <MessageBubble 
              key={msg.id} 
              msg={msg} 
              messages={chatMessages} 
              isMe={msg.sender_id === sessionProfileId} 
              sessionRole={sessionRole}
              onReply={setReplyingTo}
              onDeleteForMe={handleDeleteForMe}
              onDeleteForEveryone={handleDeleteForEveryone}
            />
          ))
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center py-10 opacity-70">
            <div className="h-16 w-16 rounded-full bg-stone-900 border border-slate-800 flex items-center justify-center mb-3">
              <MessageSquare className="h-8 w-8 text-teal-500/30" />
            </div>
            <p className="text-sm font-semibold text-slate-300">Co-ordination Channel is empty</p>
            <p className="text-xs text-muted-foreground max-w-xs mt-1">Be the first to post a coordination update or check-in note!</p>
          </div>
        )}
      </div>

      <div className="flex flex-col shrink-0">
        {replyingTo && (
          <div className="px-4 py-2 border-t border-border/50 bg-muted/20 flex items-center justify-between">
            <div className="flex items-start gap-2 max-w-[85%]">
              <CornerDownRight className="w-4 h-4 mt-0.5 text-teal-500 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-teal-400 mb-0.5">Replying to {replyingTo.sender_name}</p>
                <p className="text-xs text-muted-foreground truncate">{replyingTo.content}</p>
              </div>
            </div>
            <button 
              onClick={() => setReplyingTo(null)}
              className="p-1 rounded-full hover:bg-slate-800 text-slate-400 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <form
          onSubmit={handleSendChatMessage}
          className="p-3 border-t border-border/50 bg-muted/10 flex items-center gap-2.5"
        >
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Type a message to leaders..."
            className="flex-grow bg-background/50 border border-border/50 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500/50"
          />
          <button
            type="submit"
            disabled={!chatInput.trim() || isSendingChatMessage}
            className="bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-white rounded-xl px-4 py-2.5 font-medium text-sm transition-colors flex items-center justify-center"
          >
            {isSendingChatMessage ? "Sending..." : "Send"}
          </button>
        </form>
      </div>
    </div>
  );
}
