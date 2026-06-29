import { useTranslation } from "react-i18next";

interface LogoProps {
  className?: string;
}

export function LogoWordmark({ className }: LogoProps) {
  const { t } = useTranslation("shared");
  return (
    <>
      <img
        src="/logo-wordmark.svg"
        alt={t("logoAlt")}
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
