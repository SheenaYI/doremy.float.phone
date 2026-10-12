// lib/local-identity.ts
// 单用户身份替身。
//
// 背景：「一起听」等音乐模块来自 Yyk-Y2k/ai-virtual-phone-Y2Kversion（AGPL-3.0），
// 那边有一套多用户「身份空间」机制（lib/identity-runtime.ts + lib/identity-access.ts，
// 每个身份一套独立 IndexedDB，可切换）。本仓库没有这套东西，也只有一个用户。
//
// 与其把 214 行身份体系整体搬进来（会引入一个本仓库并不需要的概念，还要动存储层），
// 不如在这里提供同名的单用户语义替身：移植过来的代码一行不用改，身份相关的假设
// 集中收敛在本文件里，将来若真要做多用户，只需替换这一个模块。
//
// 注意：这些函数是「访问门禁」性质，单用户下门禁恒开、身份恒为一个固定常量。
// 这不是"未实现"，而是这个部署形态下的正确语义。

/** 单用户场景下的固定身份标识。写成有意义的字面量而不是 null，便于排查日志。 */
export const LOCAL_IDENTITY_ID = "local";

/** 本仓库是单用户单机部署，永远有活跃身份。 */
export function assertIdentityActive(): void {
    /* 恒成立 */
}

/** 当前身份标识，永远存在。 */
export function getCurrentIdentityId(): string {
    return LOCAL_IDENTITY_ID;
}

/**
 * 能否与某角色互动。
 *
 * 原实现在多身份下按「身份 × 角色」的授权表判定。单用户下不做角色级授权，
 * 恒为可互动 —— 保留这个形状是为了让移植代码的调用点保持原样。
 */
export function canCurrentIdentityInteract(_characterId: string): boolean {
    return true;
}

/** 角色身份访问断言。单用户下恒通过。 */
export function assertCharacterIdentityAccess(_characterId: string): void {
    /* 恒通过 */
}
