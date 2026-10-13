import { describe, expect, it } from "vitest";
import { TodoService, type ActionRow } from "./catalog-todos";

const unknown={kind:"unknown" as const,reason:"未设置"};
const base: ActionRow={
  id:"00000000-0000-4000-8000-000000000001",owner_user_id:"00000000-0000-4000-8000-000000000002",
  card_id:null,participation_id:null,version:1,title:"核对",type:"custom",node_kind:"custom",action_key:"custom:1",
  status:"pending",deadline:unknown,planned_for:unknown,snoozed_until:unknown,
  show_in_calendar:true,create_todo:true,primary_action:{kind:"detail",resourceId:"1",label:"查看",enabled:true},
  source_version:1,history:[],card:null,
};

describe("todo date and deadline projection",()=>{
  const service=new TodoService();
  it("keeps a no-card unknown date in undated without inventing a deadline",()=>{
    const dto=service.dto(base,"Asia/Shanghai",new Date("2028-03-12T00:00:00Z"));
    expect(dto).toMatchObject({card:null,group:"undated",deadline:unknown});
  });
  it("uses local calendar days across DST rather than adding fixed 24-hour days",()=>{
    const row={...base,deadline:{kind:"date" as const,value:"2028-03-12",timezone:"America/New_York"}};
    expect(service.dto(row,"America/New_York",new Date("2028-03-13T03:59:59Z")).group).toBe("today");
    expect(service.dto(row,"America/New_York",new Date("2028-03-13T04:00:00Z")).group).toBe("overdue");
  });
  it("treats an instant as overdue only after its exact cutoff, even when snoozed",()=>{
    const cutoff="2028-03-12T15:00:00.000Z";
    const row={...base,deadline:{kind:"instant" as const,value:cutoff,timezone:"America/New_York"},
      snoozed_until:{kind:"instant" as const,value:"2028-03-13T15:00:00.000Z",timezone:"America/New_York"}};
    expect(service.dto(row,"America/New_York",new Date(cutoff)).group).toBe("today");
    const after=service.dto(row,"America/New_York",new Date("2028-03-12T15:00:00.001Z"));
    expect(after.group).toBe("overdue");
    expect(after.urgency.label).toContain("稍后提示");
  });
});
