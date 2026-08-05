import { authRepository } from "../modules/auth";
import { feeEventRepository, runCalendarReconcile } from "../modules/fee-events";
import { ensureFeeEventReminders } from "../modules/reminders";

export { runCalendarReconcile };

export async function runReminderDispatch() {
  const users = await authRepository.listActiveUsers();
  let reminders = 0;
  for (const user of users) {
    const events = await feeEventRepository.list(user.id);
    for (const event of events.filter((item) => item.status === "pending")) {
      const pending = await ensureFeeEventReminders(user.id, event, user.timezone);
      reminders += pending.length;
    }
  }
  return { users: users.length, pendingReminders: reminders };
}
