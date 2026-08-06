import { useState } from 'react';

// Two-level navigation: a row of group pills, and — for any group with more than one
// item — a second row of sub-tab pills underneath. Groups with exactly one item skip
// the sub-tab row entirely and just render that item directly, so a lone "Dashboard"
// group doesn't get a redundant single-button row under it.
//
// groups: [{ key, label, icon: LucideComponent, items: [{ key, label, icon, Component }] }]
export default function GroupedTabs({ groups }) {
  const [groupKey, setGroupKey] = useState(groups[0].key);
  const [itemKey, setItemKey] = useState(groups[0].items[0].key);

  const activeGroup = groups.find((g) => g.key === groupKey) || groups[0];
  const activeItem = activeGroup.items.find((i) => i.key === itemKey) || activeGroup.items[0];
  const Active = activeItem.Component;

  function selectGroup(g) {
    setGroupKey(g.key);
    setItemKey(g.items[0].key);
  }

  return (
    <div className="grouped-nav">
      <div className="grouped-nav__groups">
        {groups.map((g) => {
          const GIcon = g.icon;
          return (
            <button
              key={g.key}
              className={`grouped-nav__group ${g.key === activeGroup.key ? 'active' : ''}`}
              onClick={() => selectGroup(g)}
            >
              {GIcon && <GIcon size={15} />}
              {g.label}
            </button>
          );
        })}
      </div>
      {activeGroup.items.length > 1 && (
        <div className="grouped-nav__subtabs">
          {activeGroup.items.map((item) => {
            const IIcon = item.icon;
            return (
              <button
                key={item.key}
                className={`grouped-nav__subtab ${item.key === activeItem.key ? 'active' : ''}`}
                onClick={() => setItemKey(item.key)}
              >
                {IIcon && <IIcon size={14} />}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
      <div style={{ marginTop: 18 }}>
        <Active />
      </div>
    </div>
  );
}
