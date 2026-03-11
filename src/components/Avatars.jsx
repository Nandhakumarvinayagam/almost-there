/**
 * Emoji-based avatar system — 20 native emoji characters.
 * Emojis have their own intrinsic colors; no tinting needed.
 * Array indices are preserved so existing avatarId values in Firebase remain valid.
 */

export const AVATARS = [
  { id: 0,  emoji: '🐱', label: 'Cat' },
  { id: 1,  emoji: '🐶', label: 'Dog' },
  { id: 2,  emoji: '🦊', label: 'Fox' },
  { id: 3,  emoji: '🐻', label: 'Bear' },
  { id: 4,  emoji: '🐼', label: 'Panda' },
  { id: 5,  emoji: '🐨', label: 'Koala' },
  { id: 6,  emoji: '🦁', label: 'Lion' },
  { id: 7,  emoji: '🐯', label: 'Tiger' },
  { id: 8,  emoji: '🐸', label: 'Frog' },
  { id: 9,  emoji: '🐵', label: 'Monkey' },
  { id: 10, emoji: '🐔', label: 'Chicken' },
  { id: 11, emoji: '🦉', label: 'Owl' },
  { id: 12, emoji: '🦋', label: 'Butterfly' },
  { id: 13, emoji: '🐙', label: 'Octopus' },
  { id: 14, emoji: '🦄', label: 'Unicorn' },
  { id: 15, emoji: '🐲', label: 'Dragon' },
  { id: 16, emoji: '🦈', label: 'Shark' },
  { id: 17, emoji: '🐢', label: 'Turtle' },
  { id: 18, emoji: '🐝', label: 'Bee' },
  { id: 19, emoji: '👻', label: 'Ghost' },
];

/**
 * Renders a single emoji avatar at the given size.
 * The color prop is accepted for backward compatibility but not applied —
 * emojis have their own intrinsic colors.
 */
export function AvatarIcon({ avatarId, size = 32, className = '', color }) { // eslint-disable-line no-unused-vars
  const avatar = AVATARS[avatarId];
  if (!avatar) return null;
  return (
    <span
      role="img"
      aria-label={avatar.label}
      className={className}
      style={{
        fontSize: size * 0.7,
        lineHeight: 1,
        userSelect: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
      }}
    >
      {avatar.emoji}
    </span>
  );
}

/**
 * Grid picker for selecting an avatar. Shows all 20 as clickable cells.
 * Selection indicator: white border + scale(1.1) + white checkmark badge.
 */
export function AvatarPicker({ selected, onSelect }) {
  return (
    <div className="avatar-picker" role="radiogroup" aria-label="Choose an avatar">
      {AVATARS.map(({ id, emoji, label }) => {
        const isSelected = selected === id;
        return (
          <button
            key={id}
            type="button"
            className={`avatar-picker-item${isSelected ? ' avatar-picker-item-selected' : ''}`}
            onClick={() => onSelect(isSelected ? null : id)}
            aria-label={label}
            aria-checked={isSelected}
            role="radio"
            style={{ position: 'relative' }}
          >
            <span style={{ fontSize: 22, lineHeight: 1 }}>{emoji}</span>
            {isSelected && (
              <span style={{
                position: 'absolute',
                bottom: -2,
                right: -2,
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                color: '#1a1a1a',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              }}>
                ✓
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
