import Link from "next/link";
import { getCardioRecords } from "@/db/home-records";
import { getWeightUnit } from "@/db/preferences";
import { formatPace, secPerMile, M_PER_MILE } from "@/lib/home/pace";
import type { HomeSectionShape } from "@/lib/home/registry";
import { formatDurationInput } from "@/lib/duration";
import { getTranslations } from "next-intl/server";

const M_PER_KM = 1000;

/**
 * All-time conditioning records: best pace, longest distance, longest
 * duration.
 *
 * Every one of the three is independently nullable, so the tall form drops
 * the rows it cannot fill rather than inventing them, and the widget renders
 * nothing when none of the three exists. Pace leads because it is the only
 * one of the three that improves rather than accumulates.
 */
export async function PaceRecord({
  userId,
  shape,
}: {
  userId: string;
  shape: HomeSectionShape;
}) {
  const t = await getTranslations("PaceRecord");
  const [records, unit] = await Promise.all([
    getCardioRecords(userId),
    getWeightUnit(userId),
  ]);
  const { bestPace, longestDistanceM, longestDurationSec } = records;
  if (
    bestPace === null &&
    longestDistanceM === null &&
    longestDurationSec === null
  )
    return null;

  // Distance follows the weight preference: someone who logs in pounds is
  // not expecting kilometres back.
  const perUnit = unit === "lb" ? M_PER_MILE : M_PER_KM;
  const distanceLabel = unit === "lb" ? t("unit.miles") : t("unit.km");
  const formatDistance = (m: number) => (m / perUnit).toFixed(1);

  const headline =
    bestPace !== null
      ? {
          // The pace must be converted, not just relabelled: a km pace shown
          // under a mile label is a lie that looks plausible.
          value: formatPace(
            unit === "lb" ? secPerMile(bestPace.secPerKm) : bestPace.secPerKm,
          ),
          caption: t("perDistance", { unit: distanceLabel }),
        }
      : longestDistanceM !== null
        ? {
            value: formatDistance(longestDistanceM.distanceM),
            caption: distanceLabel,
          }
        : {
            value: formatDurationInput(longestDurationSec!.durationSec),
            caption: t("longest"),
          };

  return (
    <Link
      href="/stats"
      className="flex h-full flex-col transition-colors active:bg-muted/60"
    >
      <span className="font-display text-[0.66rem] font-medium uppercase leading-none tracking-[0.15em] text-muted-foreground">
        {bestPace !== null ? t("title") : t("titleRecords")}
      </span>

      <span className="mt-auto flex flex-col justify-end">
        <span className="font-display text-[2.1rem] font-semibold leading-[0.82] tnum">
          {headline.value}
        </span>
        <span className="mt-1.5 block text-[0.7rem] text-muted-foreground">
          {headline.caption}
        </span>
      </span>

      {/* `tall` has room for the other two records beneath the headline. */}
      {shape === "tall" && (
        <span className="mt-auto flex flex-col pt-2">
          {longestDistanceM !== null && (
            <span className="flex items-baseline justify-between gap-2 border-b border-b-border/60 py-1.5 text-[0.73rem] last:border-b-0">
              <span className="text-muted-foreground">{t("row.distance")}</span>
              <span className="font-medium tnum">
                {formatDistance(longestDistanceM.distanceM)} {distanceLabel}
              </span>
            </span>
          )}
          {longestDurationSec !== null && (
            <span className="flex items-baseline justify-between gap-2 border-b border-b-border/60 py-1.5 text-[0.73rem] last:border-b-0">
              <span className="text-muted-foreground">{t("row.duration")}</span>
              <span className="font-medium tnum">
                {formatDurationInput(longestDurationSec.durationSec)}
              </span>
            </span>
          )}
        </span>
      )}
    </Link>
  );
}
