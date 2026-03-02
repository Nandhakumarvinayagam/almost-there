export default function MatIcon({ name, size = 20, fill = false, className = '', style = {} }) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}`,
        ...style
      }}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
