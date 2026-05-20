interface LogoProps {
  className?: string;
}

export function LogoWordmark({ className }: LogoProps) {
  return (
    <>
      <img
        src="/logo-wordmark.svg"
        alt="Table View"
        className={`block dark:hidden ${className ?? ""}`.trim()}
        draggable={false}
      />
      <img
        src="/logo-wordmark-inverted.svg"
        alt=""
        aria-hidden="true"
        className={`hidden dark:block ${className ?? ""}`.trim()}
        draggable={false}
      />
    </>
  );
}
