import {
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  CreditCard,
  Grid2X2,
  Menu,
  Plus,
  Search,
  Settings,
  Sparkles,
  TrendingUp,
  X,
  Clock3,
  ChevronDown,
  Ellipsis,
} from "lucide-react";

type IconProps = { size?: number; stroke?: number };

const icons = {
  grid: Grid2X2,
  credit: CreditCard,
  calendar: CalendarDays,
  bell: Bell,
  settings: Settings,
  plus: Plus,
  search: Search,
  arrow: ArrowRight,
  close: X,
  check: Check,
  clock: Clock3,
  menu: Menu,
  trend: TrendingUp,
  sparkles: Sparkles,
  chevronDown: ChevronDown,
  more: Ellipsis,
};

export function Icon({
  name,
  size = 18,
  stroke = 1.8,
}: IconProps & { name: keyof typeof icons }) {
  const LucideIcon = icons[name];
  return <LucideIcon aria-hidden="true" size={size} strokeWidth={stroke} />;
}
