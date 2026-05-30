import { useRef, useEffect } from "react";
import { MessageSquare, Trash2 } from "lucide-react";
import { RoleBadge } from "./shared";

interface ChatMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  sender_role: "super_admin" | "leader" | "member" | "visitor";
  content: string;
  created_at: string;
}

interface ChannelPanelProps {
  sessionRole: string;
  sessionProfileId: string;
  chatMessages: ChatMessage[];
  chatConnectionStatus: "connecting" | "connected" | "polling" | "error";
  chatInput: string;
  setChatInput: (input: string) => void;
  isSendingChatMessage: boolean;
  handleSendChatMessage: (e?: React.FormEvent) => void;
  handleDeleteChatMessage: (id: string) => void;
}

export function ChannelPanel({
  sessionRole,
  sessionProfileId,
  chatMessages,
  chatConnectionStatus,
  chatInput,
  setChatInput,
  isSendingChatMessage,
  handleSendChatMessage,
  handleDeleteChatMessage,
}: ChannelPanelProps) {
  const chatMessagesContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on messages change
  useEffect(() => {
    if (chatMessagesContainerRef.current) {
      chatMessagesContainerRef.current.scrollTop = chatMessagesContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  return (
    <div className="border border-border/50 rounded-2xl bg-card/40 backdrop-blur-sm overflow-hidden flex flex-col h-[650px] shadow-2xl relative">
      {/* Header */}
      <div className="p-4 border-b border-border/50 flex items-center justify-between bg-muted/10">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-full bg-teal-500/10 flex items-center justify-center border border-teal-500/20 shadow-inner">
            <MessageSquare className="h-4.5 w-4.5 text-teal-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Co-ordination Channel</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">Private channel for leaders & admins</p>
          </div>
        </div>

        {/* Real-time Status Indicator */}
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

      {/* Message Board */}
      <div
        ref={chatMessagesContainerRef}
        className="flex-grow overflow-y-auto p-4 space-y-4 bg-slate-950/20 scrollbar-thin scrollbar-thumb-slate-800"
      >
        {chatMessages.length > 0 ? (
          chatMessages.map((msg) => {
            const isMe = msg.sender_id === sessionProfileId;
            const msgDate = new Date(msg.created_at);
            const timeStr = isNaN(msgDate.getTime())
              ? ""
              : msgDate.toLocaleTimeString("en-ZA", {
                  hour: "2-digit",
                  minute: "2-digit",
                });

            return (
              <div
                key={msg.id}
                className={`flex items-start gap-2.5 max-w-[85%] ${
                  isMe ? "ml-auto flex-row-reverse" : "mr-auto"
                }`}
              >
                {/* Sender Initial Bubble */}
                {!isMe && (
                  <div className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold text-teal-300 bg-teal-500/10 border border-teal-500/20 shrink-0">
                    {msg.sender_name?.charAt(0)?.toUpperCase() ?? "?"}
                  </div>
                )}

                {/* Message Bubble Container */}
                <div className="space-y-1">
                  {/* Message Bubble */}
                  <div
                    className={`rounded-2xl px-4 py-2.5 text-sm shadow-md border ${
                      isMe
                        ? "bg-gradient-to-br from-teal-600 to-cyan-600 text-white border-teal-500/20 rounded-tr-none"
                        : "bg-slate-800/90 text-slate-100 border-slate-700/60 rounded-tl-none"
                    }`}
                  >
                    <p className="leading-relaxed break-words whitespace-pre-wrap">{msg.content}</p>
                  </div>

                  {/* Info Row (Sender name, role, time) */}
                  <div
                    className={`flex items-center gap-1.5 text-[10px] text-muted-foreground px-1 ${
                      isMe ? "justify-end" : "justify-start"
                    }`}
                  >
                    {!isMe && (
                      <span className="font-semibold text-slate-300">
                        {msg.sender_name}
                      </span>
                    )}
                    <RoleBadge role={msg.sender_role} />
                    <span>{timeStr}</span>

                    {/* Super Admin Moderation Delete Action */}
                    {sessionRole === "super_admin" && (
                      <button
                        onClick={() => handleDeleteChatMessage(msg.id)}
                        className="text-muted-foreground/40 hover:text-red-400 p-0.5 duration-200 transition-colors cursor-pointer"
                        title="Delete Message"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center py-10 opacity-70">
            <div className="h-16 w-16 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mb-3">
              <MessageSquare className="h-8 w-8 text-teal-500/30" />
            </div>
            <p className="text-sm font-semibold text-slate-300">Co-ordination Channel is empty</p>
            <p className="text-xs text-muted-foreground max-w-xs mt-1">Be the first to post a coordination update or check-in note!</p>
          </div>
        )}
      </div>

      {/* Input Bar */}
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
  );
}
