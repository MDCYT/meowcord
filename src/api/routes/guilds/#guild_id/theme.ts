/* SPDX-License-Identifier: AGPL-3.0-only */
import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Guild, Member } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";
import { GuildTheme, GuildThemeCustomSettings, GuildThemeModifySchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    const [guild, member] = await Promise.all([Guild.findOne({ where: { id: guild_id } }), Member.findOne({ where: { guild_id, id: req.user_id } })]);
    if (!guild) throw DiscordApiErrors.UNKNOWN_GUILD;
    if (!member) throw DiscordApiErrors.MISSING_ACCESS;

    const theme = guild.theme ?? null;
    return res.json({
        theme,
        preset_id: theme?.preset_id ?? null,
        custom_user_theme_settings: theme?.custom_user_theme_settings ?? null,
        enabled: theme?.enabled ?? false,
    });
});

router.patch(
    "/",
    route({
        requestBody: "GuildThemeModifySchema",
        permission: "MANAGE_GUILD",
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const guild = await Guild.findOne({ where: { id: guild_id } });
        if (!guild) throw DiscordApiErrors.UNKNOWN_GUILD;

        const body = req.body as GuildThemeModifySchema;
        const enabled = body.enabled !== undefined ? Boolean(body.enabled) : (guild.theme?.enabled ?? false);
        const preset_id = body.preset_id === undefined ? (guild.theme?.preset_id ?? null) : typeof body.preset_id === "number" ? Math.max(0, Math.floor(body.preset_id)) : null;

        let custom_user_theme_settings: GuildThemeCustomSettings | null = guild.theme?.custom_user_theme_settings ?? null;
        if (body.custom_user_theme_settings !== undefined) {
            if (body.custom_user_theme_settings && typeof body.custom_user_theme_settings === "object") {
                const c = body.custom_user_theme_settings;
                const colors = Array.isArray(c.colors) ? c.colors.filter((x): x is string => typeof x === "string" && /^#[0-9a-fA-F]{6}$/.test(x)).slice(0, 10) : [];
                const stops = Array.isArray(c.gradient_color_stops)
                    ? c.gradient_color_stops
                          .filter((x): x is number => typeof x === "number" && !Number.isNaN(x))
                          .map((x) => Math.min(100, Math.max(0, Math.floor(x))))
                          .slice(0, 10)
                    : [];
                const angle = typeof c.gradient_angle === "number" && !Number.isNaN(c.gradient_angle) ? Math.min(360, Math.max(0, Math.floor(c.gradient_angle))) : 0;
                const mix = typeof c.base_mix === "number" && !Number.isNaN(c.base_mix) ? Math.min(100, Math.max(0, Math.floor(c.base_mix))) : 0;

                custom_user_theme_settings = {
                    colors,
                    gradient_color_stops: stops,
                    gradient_angle: angle,
                    base_mix: mix,
                };
            } else {
                custom_user_theme_settings = null;
            }
        }

        const theme: GuildTheme = {
            preset_id,
            custom_user_theme_settings,
            enabled,
        };

        guild.theme = theme;
        await guild.save();

        await Guild.emitUpdate(guild_id);

        return res.json({
            theme,
            preset_id: theme.preset_id,
            custom_user_theme_settings: theme.custom_user_theme_settings,
            enabled: theme.enabled,
        });
    },
);

export default router;
