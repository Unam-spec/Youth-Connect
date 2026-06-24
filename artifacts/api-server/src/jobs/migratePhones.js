var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import { Pool } from "pg";
import { config } from "dotenv";
import { join } from "path";
config({ path: join(process.cwd(), ".env") });
var DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error("DATABASE_URL is required in .env");
    process.exit(1);
}
var pool = new Pool({ connectionString: DATABASE_URL });
function toE164(phone, defaultCc) {
    if (typeof phone !== "string")
        return null;
    var p = phone.trim().replace(/[\s\-().]/g, "");
    if (!p)
        return null;
    if (p.startsWith("+")) {
        // keep as-is
    }
    else if (p.startsWith("00")) {
        p = "+" + p.slice(2);
    }
    else if (p.startsWith("0")) {
        p = defaultCc + p.slice(1);
    }
    else if (/^\d{6,15}$/.test(p)) {
        if (p.startsWith("27") || p.startsWith("267")) {
            p = "+" + p;
        }
        else {
            p = defaultCc + p;
        }
    }
    else {
        return null;
    }
    var digits = p.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15)
        return null;
    return "+" + digits;
}
function run() {
    return __awaiter(this, void 0, void 0, function () {
        var client, profiles, profileUpdates, _i, profiles_1, p, defaultCc, updated, newPhone, newParentPhone, e, e, visitors, visitorUpdates, _a, visitors_1, v, defaultCc, updated, newPhone, newParentPhone, e, e, error_1;
        var _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    console.log("Connecting to database...");
                    return [4 /*yield*/, pool.connect()];
                case 1:
                    client = _d.sent();
                    _d.label = 2;
                case 2:
                    _d.trys.push([2, 15, 17, 18]);
                    return [4 /*yield*/, client.query("BEGIN")];
                case 3:
                    _d.sent();
                    return [4 /*yield*/, client.query('SELECT id, full_name, phone, parent_phone FROM profiles')];
                case 4:
                    profiles = (_d.sent()).rows;
                    console.log("Found ".concat(profiles.length, " profiles to check."));
                    profileUpdates = 0;
                    _i = 0, profiles_1 = profiles;
                    _d.label = 5;
                case 5:
                    if (!(_i < profiles_1.length)) return [3 /*break*/, 8];
                    p = profiles_1[_i];
                    defaultCc = ((_b = p.full_name) === null || _b === void 0 ? void 0 : _b.toLowerCase().includes("kgosi quincy")) ? "+267" : "+27";
                    updated = false;
                    newPhone = p.phone;
                    newParentPhone = p.parent_phone;
                    if (p.phone && !p.phone.startsWith("+")) {
                        e = toE164(p.phone, defaultCc);
                        if (e && e !== p.phone) {
                            newPhone = e;
                            updated = true;
                        }
                    }
                    if (p.parent_phone && !p.parent_phone.startsWith("+")) {
                        e = toE164(p.parent_phone, defaultCc);
                        if (e && e !== p.parent_phone) {
                            newParentPhone = e;
                            updated = true;
                        }
                    }
                    if (!updated) return [3 /*break*/, 7];
                    return [4 /*yield*/, client.query('UPDATE profiles SET phone = $1, parent_phone = $2 WHERE id = $3', [newPhone, newParentPhone, p.id])];
                case 6:
                    _d.sent();
                    profileUpdates++;
                    _d.label = 7;
                case 7:
                    _i++;
                    return [3 /*break*/, 5];
                case 8:
                    console.log("Updated ".concat(profileUpdates, " profiles."));
                    return [4 /*yield*/, client.query('SELECT id, full_name, phone_number, parent_phone FROM visitors')];
                case 9:
                    visitors = (_d.sent()).rows;
                    console.log("Found ".concat(visitors.length, " visitors to check."));
                    visitorUpdates = 0;
                    _a = 0, visitors_1 = visitors;
                    _d.label = 10;
                case 10:
                    if (!(_a < visitors_1.length)) return [3 /*break*/, 13];
                    v = visitors_1[_a];
                    defaultCc = ((_c = v.full_name) === null || _c === void 0 ? void 0 : _c.toLowerCase().includes("kgosi quincy")) ? "+267" : "+27";
                    updated = false;
                    newPhone = v.phone_number;
                    newParentPhone = v.parent_phone;
                    if (v.phone_number && !v.phone_number.startsWith("+")) {
                        e = toE164(v.phone_number, defaultCc);
                        if (e && e !== v.phone_number) {
                            newPhone = e;
                            updated = true;
                        }
                    }
                    if (v.parent_phone && !v.parent_phone.startsWith("+")) {
                        e = toE164(v.parent_phone, defaultCc);
                        if (e && e !== v.parent_phone) {
                            newParentPhone = e;
                            updated = true;
                        }
                    }
                    if (!updated) return [3 /*break*/, 12];
                    return [4 /*yield*/, client.query('UPDATE visitors SET phone_number = $1, parent_phone = $2 WHERE id = $3', [newPhone, newParentPhone, v.id])];
                case 11:
                    _d.sent();
                    visitorUpdates++;
                    _d.label = 12;
                case 12:
                    _a++;
                    return [3 /*break*/, 10];
                case 13:
                    console.log("Updated ".concat(visitorUpdates, " visitors."));
                    return [4 /*yield*/, client.query("COMMIT")];
                case 14:
                    _d.sent();
                    console.log("Migration completed successfully.");
                    return [3 /*break*/, 18];
                case 15:
                    error_1 = _d.sent();
                    return [4 /*yield*/, client.query("ROLLBACK")];
                case 16:
                    _d.sent();
                    console.error("Migration failed:", error_1);
                    return [3 /*break*/, 18];
                case 17:
                    client.release();
                    pool.end();
                    return [7 /*endfinally*/];
                case 18: return [2 /*return*/];
            }
        });
    });
}
run();
