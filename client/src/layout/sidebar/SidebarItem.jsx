import { Link, useLocation } from "react-router-dom";

const SidebarItem = (props) => {
  const { to, name, children, onClick } = props;
  const location = useLocation();

  // text-secondary (#1094ea) on this background measures ~2.1:1 contrast,
  // well under WCAG AA — white text plus a weight change keeps the active
  // state legible and doesn't rely on color alone to signal it.
  const className =
    (location.pathname.startsWith(to) && to !== "/") ||
    (location.pathname === to && to === "/")
      ? "bg-[#4c5b69] text-white font-semibold"
      : "";

  return (
    <li className="w-full transition">
      <Link
        onClick={() => {
          onClick?.();
          window.scrollTo({ top: 0 });
        }}
        to={to}
      >
        <div
          className={`flex gap-3 items-center px-3 py-2 rounded-xl max-w-70 transition hover:bg-[#4c5b69] ${className}`}
        >
          <span className="w-8">{children}</span>
          <div className={`flex-1 min-w-0 `}>
            <span className="block truncate" title={name}>
              {name}
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
};

export default SidebarItem;
