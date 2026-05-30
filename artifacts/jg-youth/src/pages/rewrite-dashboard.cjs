const fs = require('fs');

const file = 'artifacts/jg-youth/src/pages/dashboard.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Add panel imports after Lucide imports
content = content.replace(
  'import { QRCodeSVG } from "qrcode.react";',
  'import { QRCodeSVG } from "qrcode.react";\nimport { AttendancePanel } from "@/components/panels/AttendancePanel";\nimport { MemberDirectoryPanel } from "@/components/panels/MemberDirectoryPanel";\nimport { EventsPanel } from "@/components/panels/EventsPanel";\nimport { RequestsPanel } from "@/components/panels/RequestsPanel";\nimport { RSVPPanel } from "@/components/panels/RSVPPanel";\nimport { LeaderManagementPanel } from "@/components/panels/LeaderManagementPanel";\nimport { PinManagementPanel } from "@/components/panels/PinManagementPanel";\nimport { AdminSlotsPanel } from "@/components/panels/AdminSlotsPanel";\nimport { ChannelPanel } from "@/components/panels/ChannelPanel";\nimport { Activity, Settings } from "lucide-react";'
);

// 2. Extract everything before the Tabs
const tabsStartIdx = content.indexOf('{/* ── Tabs ── */}');
if (tabsStartIdx === -1) {
    console.error("Could not find {/* ── Tabs ── */} string");
    process.exit(1);
}

// 3. Find where </Tabs> ends
const tabsEndIdx = content.indexOf('</Tabs>', tabsStartIdx);
if (tabsEndIdx === -1) {
    console.error("Could not find </Tabs>");
    process.exit(1);
}

const beforeTabs = content.substring(0, tabsStartIdx);
const afterTabs = content.substring(tabsEndIdx + 7);

const newTabs = `
        {/* ── Tabs ── */}
        <Tabs
          defaultValue="session"
          onValueChange={(val) => {
            setActiveTab(val);
            if (val === "manage") fetchLeaderPins();
          }}
        >
          <TabsList className="grid grid-cols-4 gap-2 mb-6 bg-card/60 p-2 rounded-xl backdrop-blur-sm">
            <TabsTrigger value="session" className="rounded-lg py-2 data-[state=active]:bg-teal-500 data-[state=active]:text-white">
              <Activity className="h-4 w-4 mr-2 hidden sm:block" /> Session
            </TabsTrigger>
            <TabsTrigger value="members" className="rounded-lg py-2 data-[state=active]:bg-teal-500 data-[state=active]:text-white">
              <Users className="h-4 w-4 mr-2 hidden sm:block" /> Members
            </TabsTrigger>
            <TabsTrigger value="events" className="rounded-lg py-2 data-[state=active]:bg-teal-500 data-[state=active]:text-white">
              <Calendar className="h-4 w-4 mr-2 hidden sm:block" /> Events
            </TabsTrigger>
            <TabsTrigger value="manage" className="rounded-lg py-2 data-[state=active]:bg-teal-500 data-[state=active]:text-white">
              <Settings className="h-4 w-4 mr-2 hidden sm:block" /> Manage
            </TabsTrigger>
          </TabsList>

          <TabsContent value="session" className="mt-0 space-y-6">
            <AttendancePanel
              pendingCheckIns={pendingCheckIns}
              isPendingLoading={isPendingLoading}
              fetchPendingCheckIns={fetchPendingCheckIns}
              handleApproveCheckIn={handleApproveCheckIn}
              handleRejectCheckIn={handleRejectCheckIn}
            />
            <ChannelPanel
              sessionRole={session.role}
              sessionProfileId={session.profile_id}
              chatMessages={chatMessages}
              chatConnectionStatus={chatConnectionStatus}
              chatInput={chatInput}
              setChatInput={setChatInput}
              isSendingChatMessage={isSendingChatMessage}
              handleSendChatMessage={handleSendChatMessage}
              handleDeleteChatMessage={handleDeleteChatMessage}
            />
          </TabsContent>

          <TabsContent value="members" className="mt-0 space-y-6">
            <RequestsPanel
              pendingFirstTimers={pendingFirstTimers}
              isPendingLoading={isPendingLoading}
              handleApproveCheckIn={handleApproveCheckIn}
              handleRejectCheckIn={handleRejectCheckIn}
              mutateRequest={mutateRequest}
            />
            {canViewMembers && (
              <MemberDirectoryPanel
                sessionRole={session.role}
                superAdminCount={superAdminCount}
                openEditDialog={openEditDialog}
                mutateProfileRole={mutateProfileRole}
                setRoleConfirm={setRoleConfirm}
                handlePermissionChange={handlePermissionChange}
                setDeleteMemberId={setDeleteMemberId}
                setDeleteMemberName={setDeleteMemberName}
              />
            )}
          </TabsContent>

          <TabsContent value="events" className="mt-0 space-y-6">
            <EventsPanel
              sessionRole={session.role}
              canCreateEvents={session.can_create_events || session.role === "super_admin"}
              eventForm={eventForm}
              setEventForm={setEventForm}
              handleCreateEvent={handleCreateEvent}
              setDeleteEventId={setDeleteEventId}
              setDeleteEventName={setDeleteEventName}
            />
            {(session.role === "leader" || session.role === "super_admin") && (
              <RSVPPanel
                selectedEventId={selectedEventId}
                setSelectedEventId={setSelectedEventId}
                rsvps={rsvps}
                isRsvpsLoading={isRsvpsLoading}
              />
            )}
          </TabsContent>

          <TabsContent value="manage" className="mt-0 space-y-6">
            {session.role === "super_admin" && (
              <>
                <AdminSlotsPanel
                  superAdminCount={superAdminCount}
                  hasPin={hasPin}
                  setShowPinDialog={setShowPinDialog}
                  setShowWipeConfirm={setShowWipeConfirm}
                />
                <PinManagementPanel
                  leaderPins={leaderPins}
                  isLeaderPinsLoading={isLeaderPinsLoading}
                  revealedPins={revealedPins}
                  togglePinReveal={togglePinReveal}
                  setSettingPinFor={setSettingPinFor}
                />
                <LeaderManagementPanel
                  handlePermissionChange={handlePermissionChange}
                  isUpdatingPermissions={isUpdatingPermissions}
                />
              </>
            )}
          </TabsContent>
        </Tabs>`;

// 4. Also remove the sub-components at the end of the file
let finalContent = beforeTabs + newTabs + afterTabs;

const subComponentMarker = '// ── Render ──'; // Wait, let's look for `function DashCard`
const dashCardIdx = finalContent.indexOf('function DashCard');
if (dashCardIdx !== -1) {
    // Delete from `function DashCard` up to the end of the file
    // Wait, let's find the comment `// "?"? Sub-components` or similar
    const commentIdx = finalContent.lastIndexOf('//', dashCardIdx);
    if (commentIdx !== -1 && commentIdx > dashCardIdx - 200) {
        finalContent = finalContent.substring(0, commentIdx);
    } else {
        finalContent = finalContent.substring(0, dashCardIdx);
    }
}

fs.writeFileSync(file, finalContent, 'utf8');
console.log('Successfully updated dashboard.tsx');
