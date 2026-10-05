"""The original editable technology catalogue, without country cost assumptions."""


def blank_cost_mix_templates():
    from demo_adapter import frontend_defaults
    defaults = frontend_defaults()
    return {
        section: {
            mix: [{"name": row["name"], "share": None, "cost": None}
                  for row in defaults[section][mix]]
            for mix in ("sm_tech_mix", "basic_tech_mix")
        }
        for section in ("water_costs", "sanitation_costs")
    }