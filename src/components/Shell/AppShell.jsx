import Drawer from './Drawer'
import LeftRail from './LeftRail'
import TopBar from './TopBar'

export default function AppShell({
  children,
  mode,
  onModeChange,
  drawerOpen,
  onToggleDrawer,
  onDrawerClose,
  drawerContent,
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
  onOpenModal,
  backupWarning,
  themeMode,
  onThemeChange,
  onSignOut,
  onAccount,
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
        onOpenModal={onOpenModal}
        backupWarning={backupWarning}
        themeMode={themeMode}
        onThemeChange={onThemeChange}
        onSignOut={onSignOut}
      />
      <div className="ft-app-body">
        <LeftRail
          mode={mode}
          onModeChange={onModeChange}
          drawerOpen={drawerOpen}
          onToggleDrawer={onToggleDrawer}
          themeMode={themeMode}
          onThemeChange={onThemeChange}
          onAccount={onAccount}
        />
        <main className="ft-stage">{children}</main>
        <Drawer open={drawerOpen} onClose={onDrawerClose}>
          {drawerContent}
        </Drawer>
      </div>
    </div>
  )
}
