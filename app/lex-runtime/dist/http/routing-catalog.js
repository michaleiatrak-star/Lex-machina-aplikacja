import fs from "node:fs";
import { activeJurisdictionPack, jurisdictionDomainMap, isDomainSkill } from "../jurisdiction.js";
export class RoutingCatalog {
    registry;
    constructor(registry) {
        this.registry = registry;
    }
    listDrSkills() {
        return [...this.registry.skills.keys()]
            .filter((name) => isDomainSkill(name))
            .sort();
    }
    validate(primarySkill) {
        if (!isDomainSkill(primarySkill)) {
            return {
                valid: false,
                primarySkill,
                reason: "NOT_A_DR"
            };
        }
        if (!this.registry.get(primarySkill)) {
            return {
                valid: false,
                primarySkill,
                reason: "SKILL_NOT_FOUND"
            };
        }
        const routingMap = activeJurisdictionPack() && this.registry.resolveResource(activeJurisdictionPack(), jurisdictionDomainMap(this.registry.root));
        if (!routingMap) {
            return {
                valid: false,
                primarySkill,
                reason: "ROUTING_MAP_MISSING"
            };
        }
        const text = fs.readFileSync(routingMap, "utf8");
        if (!text.includes(primarySkill)) {
            return {
                valid: false,
                primarySkill,
                reason: "NOT_IN_ROUTING_MAP"
            };
        }
        return {
            valid: true,
            primarySkill
        };
    }
}
