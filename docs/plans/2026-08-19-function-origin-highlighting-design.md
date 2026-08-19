# GodParty Godot Tools 函数来源高亮设计

## 背景

Godot Tools 当前能为 GDScript 提供语法高亮、跳转、悬停、补全和调试，但 TextMate 语法把绝大多数函数声明与调用标为同一类 scope，无法稳定区分 Godot 引擎函数与项目自定义函数。仅维护函数名正则表也无法处理同名函数、继承关系和带类型接收对象的方法调用。

本插件基于官方 `godotengine/godot-vscode-plugin` 开发，源码放在 `D:\work_mine\godot\GodotTools`。上游基线为提交 `145a0f0ad5a6c726b27b18b517c217a5e1bfa91c`，保留原 MIT 许可证和版权声明。插件暂定名为 **GodParty Godot Tools**，作为官方 Godot Tools 的替代版本安装，避免两个 Godot 语言客户端同时运行。

## 已确认目标

在所有 GDScript 函数声明和调用位置提供明确、可配置的两类视觉标识：

- **系统函数**：Godot 原生 API、GDScript 内置函数和引擎生命周期/虚函数回调。
- **自定义函数**：项目 `.gd` 脚本、Autoload、addons 和 GDExtension 暴露的函数。

默认使用青蓝色表示系统函数，金黄色表示自定义函数。声明和调用遵守相同分类规则；悬停信息说明分类结果、所属类和判断依据。

## 非目标

- 不修改 Godot 编辑器自身的脚本编辑器。
- 不把 addons、Autoload、项目公共框架或 GDExtension 当成系统函数。
- 不依赖一份手工维护且与 Godot 版本无关的函数名正则表。
- 不要求用户联网才能完成分类。
- 不改变原有 Godot Tools 的调试、格式化、场景预览和 LSP 功能。

## 方案选择

### 采用：在 Godot Tools 分支中增加语义分类器

在现有扩展生命周期和 Godot LSP 客户端之上增加函数扫描、引擎 API 索引、项目符号索引和语义 token/悬停提供器。它可以复用插件已建立的 Godot 版本检测、编辑器路径和 LSP 连接，且能在同名函数发生冲突时利用定义位置与类型信息判定来源。

### 未采用：伴随插件

伴随插件开发量较小，但会与官方插件重复解析文档，并难以可靠复用官方插件内部的 LSP 客户端和状态。两个插件的启动顺序和刷新顺序也会造成不可预测的高亮结果。

### 未采用：只修改 TextMate 语法

TextMate 正则只能看到局部文本，不能知道 `target.run()` 中 `target` 的类型，也不能区分同名的系统方法和项目方法，因此无法达到准确分类目标。

## 总体架构

函数来源高亮由六个相互独立、可单测的组件组成：

1. `GDScriptFunctionScanner`：轻量扫描当前文档，跳过注释和字符串，返回函数声明、调用、接收对象文本及精确 range。
2. `ProjectSymbolIndex`：索引工作区 `.gd` 文件中的函数、`class_name`、`extends`、静态函数和显式类型声明，并监听创建、修改、删除和重命名。
3. `GodotApiIndex`：读取与当前 Godot 版本匹配的原生 API JSON，建立全局 utility function、builtin class、原生 class、继承关系和 virtual method 索引。
4. `FunctionOriginClassifier`：按照确定的优先级将每个函数 token 分类为 `system` 或 `project`，同时产生可用于悬停的证据说明。
5. `GDSemanticTokensProvider`：复用现有但尚未启用的 semantic token provider，输出 `godotSystemFunction` 和 `godotProjectFunction` token，并在文档或索引变化时主动刷新。
6. `FunctionOriginHoverProvider`：只为已分类的函数追加来源信息，不覆盖 Godot LSP 原有签名和文档内容。

核心扫描、索引和分类逻辑不得依赖 VS Code UI，以便在普通单元测试中快速覆盖。VS Code provider 只负责文档适配、事件订阅和 token/hover 输出。

## 引擎 API 索引

插件优先使用 Godot Tools 已配置的 `godotTools.editorPath.godot4`。首次遇到某个 Godot 版本时，在隔离的缓存目录执行：

```text
godot --headless --dump-extension-api
```

Godot 4.6.2 的命令行帮助确认该命令会生成 `extension_api.json`。插件把结果移动到 VS Code `globalStorageUri` 下按完整版本号命名的缓存文件，并记录生成状态。生成过程不得在用户项目目录留下 `extension_api.json`。

API JSON 中的 `utility_functions`、`builtin_classes`、`classes`、方法、virtual 标记和继承关系构成系统索引。为支持 Godot 尚未启动、可执行文件无效或生成失败的场景，VSIX 内附一份由目标 Godot 4.6 生成的只读快照。缓存生成失败时使用快照并显示非阻塞状态提示；普通 Godot Tools 功能继续工作。

GDExtension 不进入系统索引。即使某个 GDExtension 方法能通过 LSP 跳转或补全，也按已确认边界归为项目自定义函数。

## 项目符号索引

首次启用时通过 `workspace.findFiles("**/*.gd", exclude)` 建立项目索引，并排除 `.godot`、`.git`、构建输出和用户配置的排除项。索引记录：

- 脚本 URI、`class_name`、`extends` 和可解析的 preload/load 基类。
- 函数名、静态标记、声明位置和参数/返回类型文本。
- 成员变量、局部变量和参数的显式类型。
- Autoload 名称到脚本 URI 的映射。

打开文档发生变化时只重新扫描当前文档；文件 watcher 处理磁盘上的创建、修改和删除。索引更新使用短防抖和文档版本号，过期任务不能覆盖新结果。

项目索引只负责可静态证明的信息，不执行项目脚本，不加载用户代码，也不运行 addons。

## 分类规则与优先级

分类器按以下顺序工作，先命中即停止：

1. 定义或项目索引明确指向工作区 `.gd`：`project`。
2. 声明覆盖当前原生基类链中的 virtual method：`system`。
3. 无接收对象的调用命中 Godot utility function：`system`。
4. `self`、`super` 或无接收对象的方法命中当前原生基类链：`system`。
5. 接收对象具有显式 builtin/native 类型，且其方法命中 API 索引：`system`。
6. 接收对象指向项目 class、Autoload 或脚本实例：`project`。
7. 仅在仍有同名歧义时查询 Godot LSP definition/hover；若返回项目脚本则为 `project`，若返回 Godot 原生文档则为 `system`。
8. 无法证明属于引擎的剩余函数：`project`。

这个“系统需有证据，否则归项目”的回退规则保证所有识别到的函数都有明确颜色，同时避免仅凭名称把项目函数误标为系统函数。分类证据包含 `source`、`owner` 和 `reason`，例如 `Godot system function · Node.add_child · typed receiver`。

## 视觉与设置

扩展贡献两个 semantic token 类型：

- `godotSystemFunction`
- `godotProjectFunction`

默认 dark/light theme 均提供高对比但不过度刺眼的颜色映射：系统青蓝、项目金黄。用户可通过插件设置覆盖颜色，并独立设置粗体和斜体。设置至少包括：

- `godpartyGodotTools.functionHighlight.enabled`
- `godpartyGodotTools.functionHighlight.systemColor`
- `godpartyGodotTools.functionHighlight.projectColor`
- `godpartyGodotTools.functionHighlight.fontStyle`
- `godpartyGodotTools.functionHighlight.exclude`

命令面板提供启用/关闭和重建索引命令。状态栏只在“正在建立索引”“使用备用 API”“索引错误”时显示额外状态，正常完成后不长期占用空间。

## 性能、并发与容错

- 文档扫描为线性复杂度，并在编辑防抖后运行。
- 项目索引按文件增量更新，不在每次按键时重扫工作区。
- LSP 请求只用于静态索引无法解决的歧义项，并按 URI、文档版本和位置缓存。
- 所有异步结果提交前检查 cancellation token 和文档版本。
- 超过可配置尺寸的大文件先使用当前文档扫描和 API 索引，延迟项目交叉引用。
- API 生成、项目扫描或 LSP 请求失败均降级，不得阻断编辑、格式化、补全或调试。
- 输出日志不得包含完整项目源代码，只记录路径、计数、耗时和错误摘要。

## 测试与验收

单元测试使用小型 GDScript fixture 覆盖扫描 range、索引和分类：

- `print()`、`load()`、`range()` 等 utility functions。
- `Node.add_child()`、builtin type 方法和继承得到的原生方法。
- `_ready()`、`_process()` 等 virtual callback 声明与调用。
- 项目普通/静态/继承函数、Autoload、addons 和动态调用。
- 系统与项目函数同名时，项目定义优先。
- 注释、字符串、注解、lambda、多行调用和嵌套调用。
- API 缓存命中、生成失败和备用快照。

VS Code 集成测试验证 semantic token 类型、设置切换、文档更新刷新和 hover 说明。最终执行 TypeScript 编译、Biome lint、完整测试和 VSIX 打包，并在 GodParty 的 Godot 4.6 项目上做真实样例验收。验收标准是所有被扫描到的函数声明和调用都获得系统或自定义分类，且禁用功能后恢复原始 Godot Tools 显示。

## 交付物

- `GodParty Godot Tools` 完整源码。
- 保留上游 MIT `LICENSE`，README 明确列出上游来源和修改内容。
- 可安装的 `.vsix`。
- API 快照生成说明和可重复构建命令。
- 自动化测试及真实 Godot 4.6 验收记录。

