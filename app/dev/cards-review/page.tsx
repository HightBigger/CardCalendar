import { notFound } from "next/navigation";
import { WorkbenchEntry } from "../../../src/frontend/pages/workbench/Workbench";

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <>
    <aside className="fixture-banner"><strong>卡片接口联调验收</strong><p>操作会保存到当前账户的数据源，请使用测试账户。</p></aside>
    <WorkbenchEntry initialView="cards" gates={{ todos: true, activities: true, activityPeriods: false }} />
  </>;
}
