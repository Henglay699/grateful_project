import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { NAV } from './nav';
import { icons } from './icons';
import { useNavCounts } from './useNavCounts';
import { useWorkQueue } from '../features/workflow';

interface Props {
  open: boolean;
  onNavigate: () => void;
  onToggleCollapse: () => void;
}

export function Sidebar({ open, onNavigate, onToggleCollapse }: Props) {
  const { user, can } = useAuth();
  const counts = useNavCounts();
  // Jobs waiting for this role, for the My Work badge.
  const myWork = useWorkQueue('mine', can('shipments:read'));
  const { pathname } = useLocation();
  // Dropdowns the user opened or closed; untouched ones are open while you're inside them.
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({});
  if (!user) return null;

  return (
    <>
      <aside className={`sidebar${open ? ' open' : ''}`} id="sidebar" aria-label="Main navigation">
        <div className="brand">
          <div className="brand-mark">
            <img src="/logo.png" alt="Grateful Solutions logo" />
            <button
              type="button"
              className="brand-expand-btn"
              onClick={onToggleCollapse}
              aria-label="Open sidebar"
              data-tooltip="Open sidebar"
            >
              {icons.collapse({})}
            </button>
          </div>
          <div className="brand-text">
            <div className="title">Grateful Solutions</div>
            <div className="subtitle">(Cambodia) Co., Ltd.</div>
          </div>
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            {icons.collapse({})}
          </button>
        </div>

        <nav className="menu" id="menu">
          {NAV.map((group) => {
            const items = group.items.filter(
              (i) => can(i.permission) && !i.hideFor?.includes(user.role),
            );
            if (!items.length) return null;
            return (
              <div className="menu-group" key={group.heading}>
                <div className="menu-heading">{group.heading}</div>
                {items.map((item) => {
                  if (item.children) {
                    const children = item.children.filter((c) => can(c.permission));
                    const inside = pathname === item.to || pathname.startsWith(`${item.to}/`);
                    const isOpen = openMenus[item.to] ?? inside;
                    return (
                      <div className={`menu-item-wrap${isOpen ? ' open' : ''}`} key={item.to}>
                        <button
                          type="button"
                          className="menu-item"
                          aria-expanded={isOpen}
                          title={item.title}
                          onClick={() => setOpenMenus((m) => ({ ...m, [item.to]: !isOpen }))}
                        >
                          {icons[item.icon]({})}
                          {item.label}
                          <span className="submenu-toggle">{icons.chevronDown({})}</span>
                        </button>
                        <div className="submenu acc-submenu">
                          {children.map((c) => (
                            <NavLink
                              key={c.to}
                              to={c.to}
                              end={c.end}
                              onClick={onNavigate}
                              title={c.label}
                              tabIndex={isOpen ? undefined : -1}
                              className={({ isActive }) =>
                                `submenu-item has-icon${isActive || c.alsoActive?.some((p) => pathname.startsWith(p)) ? ' active' : ''}`
                              }
                            >
                              {icons[c.icon]({})}
                              {c.label}
                            </NavLink>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  const badge =
                    item.badge === 'myWork'
                      ? (myWork.data?.items.length ?? 0)
                      : item.badge && counts.data
                        ? counts.data[item.badge]
                        : 0;
                  return (
                    <div className="menu-item-wrap" key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        onClick={onNavigate}
                        title={item.sub ? item.title : undefined}
                        className={({ isActive }) =>
                          `menu-item${item.sub ? ' submenu-item has-icon' : ''}${isActive ? ' active' : ''}`
                        }
                      >
                        {icons[item.icon]({})}
                        {item.label}
                        {badge > 0 && (
                          <span
                            className="item-badge"
                            aria-label={`${badge} ${item.badge === 'openFollowUps' ? 'open' : item.badge === 'myWork' ? 'waiting' : 'unread'}`}
                          >
                            {badge}
                          </span>
                        )}
                      </NavLink>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="sidebar-scrim" onClick={onNavigate} aria-hidden="true" />
    </>
  );
}
