# FocusTree 数据库迁移

在 Supabase SQL Editor 中按文件名顺序执行：

1. `000_core_tables.sql`
2. `001_user_profile.sql`
3. `002_annotations_and_log.sql`
4. `003_sessions_and_memory.sql`
5. `004_daily_focus.sql`
6. `005_weekly_reviews.sql`

`000_core_tables.sql` 必须最先执行，因为后续迁移会引用 `nodes` 和 `conversations`。

所有业务表都启用了 RLS，策略是用户只能访问 `auth.uid() = user_id` 的数据。
