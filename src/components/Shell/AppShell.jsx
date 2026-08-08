import Drawer from './Drawer'
import LeftRail from './LeftRail'
import TopBar from './TopBar'

export default function AppShell({
  children,
  mode,
  onModeChange,
  drawerTab,
  onDrawerTab,
  onDrawerClose,
  renderDrawerTab,
  goal,
  goalText,
  goalExpired,
  onEditGoal,
  user,
  canUndo,
  canRedo,
  lastAction,
  nextAction,
  onUndo,
  onRedo,
  onOpenTab,
  backupWarning,
  themeMode,
  onThemeChange,
  onSignOut,
  hasSelection,
  pendingCount,
  temporaryTabs,
}) {
  return (
    <div className="ft-app-shell">
      <TopBar
        goal={goal}
        goalText={goalText}
        goalExpired={goalExpired}
        onEditGoal={onEditGoal}
        user={user}
        canUndo={canUndo}
        canRedo={canRedo}
        lastAction={lastAction}
        nextAction={nextAction}
        onUndo={onUndo}
        onRedo={onRedo}
        onOpenTab={onOpenTab}
        backupWarning={backupWarning}
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        onSignOut={onSignOut}
      />
      <div className="ft-app-body">
        <LeftRail
          mode={mode}
          onModeChange={onModeChange}
          drawerTab={drawerTab}
          onDrawerTab={onDrawerTab}
          pendingCount={pendingCount}
          themeMode={themeMode}
          onThemeChange={onThemeChange}
          onAccount={() => onOpenTab?.('account')}
        />
        <main className="ft-stage">{children}</main>
        <Drawer
          activeTab={drawerTab}
          onTabChange={onDrawerTab}
          onClose={onDrawerClose}
          hasSelection={hasSelection}
          pendingCount={pendingCount}
          temporaryTabs={temporaryTabs}
          renderTab={renderDrawerTab}
        />
      </div>
    </div>
  )
}
