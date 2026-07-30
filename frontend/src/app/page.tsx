import { useTranslations } from "next-intl";

export default function Home() {
  const t = useTranslations("common");
  return <main>{t("loading")}</main>;
}
