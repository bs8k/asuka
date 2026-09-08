---
title: マジックリンクでログインできない原因はメールのURLスキャンだった
tags: 認証 Next.js Security BetterAuth マジックリンク
author: kuma_3838
slide: false
---
## はじめに

本番環境で、マジックリンクでログインできないことがあるという報告を受けました。
メールに届いたリンクを押すと「この認証リンクは使用済みまたは期限切れです」と表示され、ログインできないという内容です。
利用者からは「メールのリンクを押すと一瞬 Cisco のリンクが開く」とも聞き、画面録画を見せてもらいました。

調べたところ、原因は利用者側で導入されているメールセキュリティ製品でした。
その製品の URL 解析機能が、利用者より先にリンクを開き、1 回しか使えないトークンを使い切っていました。

こんなことが起こりうるとは想像していませんでした。
1 回だけ使えるリンクをメールで送り、押されたら検証してログインさせるという、一般的なマジックリンクの作りです。
それでも、利用者がリンクを押す前に別の誰かがリンクを押してしまう経路が存在していました。

なお、この問題はマジックリンクだけの話ではありません。
パスワードリセット、招待メール、退会確認など、メールのリンクを開いたら状態が変わる機能はすべて同じ構造を持っています。

今回の調査の記録を残し、同じ事象が発生した人の助けになればと思います。

検証環境は次のとおりです。

- Next.js 15.5.23（App Router）
- better-auth 1.6.30
- Node.js 22
- インフラは AWS（CloudFront + ALB + ECS）

## この記事をざっくり図解

![image](https://pub-a61206ae19934ac48bdb67c6c59ee370.r2.dev/e7f98c6016222e394c10577c2f4bdb8d.png)

## 結論：メールスキャナがリンクを先に踏む

利用者側で導入されているメールセキュリティ製品（Cisco Secure Email）の URL 解析機能が、利用者より先にマジックリンクを開いていました。
マジックリンクは 1 回しか使えないため、解析ボットが先に開いた時点でトークンが消費されます。
あとから来た利用者のリクエストは必ず失敗します。

構造上の原因は、**GET リクエストに「認証トークンの消費」という副作用を持たせていたこと**です。

HTTP の仕様では、GET は安全（safe）なメソッドと定義されています。
クローラー、プリフェッチ、メールのリンクプレビューは、いずれもこの前提で動いています。
つまり「GET しても何も起きない」と信じて先読みしてきます。

## あなたの実装は大丈夫か

次の 3 つに当てはまるなら、同じ事象が起こりえます。

- メールで送るリンクが、GET されただけでトークンを消費する
- トークンが 1 回使い切りである
- 利用者に企業ユーザーが含まれる（メールセキュリティ製品が導入されている環境）

そして、すでに起きている場合は次のような症状が出ます。

- 「ログインできない」という問い合わせが来るのに、自分の環境では再現しない
- 再送してもらうと成功することがある
- 検証用のエンドポイントが、1 つのリンクに対して 2 回叩かれている

3 つ目がもっとも確実な判定材料です。
ログの見方はのちほど説明します。

なお、この事象は Cisco 固有のものではありません。
Microsoft Defender for Office 365（Safe Links）でも、利用者に届く前に 1 回使い切りのリンクが消費されるという報告があります。

- [Microsoft Defender Office 365 Safe Links Policy - onetimesecret Issue #359](https://github.com/onetimesecret/onetimesecret/issues/359)
- [Add a configuration option to avoid consumption of magic links from security products - magiclinksdev Issue #2](https://github.com/MicahParks/magiclinksdev/issues/2)
- [Authentication With Magic Links & One-Time Passwords - FusionAuth Docs](https://fusionauth.io/docs/lifecycle/authenticate-users/passwordless/magic-links)（Troubleshooting に、メールクライアントが利用者より先にリンクを開く場合があると記載）

ただし、製品によって挙動は異なります。
Proofpoint の URL Defense については、URL を書き換えるだけでリンク先を訪問しないため 1 回使い切りの URL は無効化されない、と導入している大学の FAQ 「[URL Defense](https://blink.ucsd.edu/technology/email/security/url-defense.html)」（カリフォルニア大学サンディエゴ校）に記載されています。
「メールセキュリティ製品が入っていれば必ず起きる」わけではなく、利用者がどの製品をどう設定して使っているかで変わります。

## なぜ起きるのか

メールセキュリティ製品は、メール本文中のリンクを自社ドメインの URL に書き換えます。
Cisco の場合は `secure-web.cisco.com` に書き換えられます（URL Rewriting）。

書き換えとは別に、**Cisco 側の解析機構がリンク先を実際に開きます**。
Cisco の公式ドキュメントには、Talos Intelligence Cloud Services が URL をクロールすると記載されています。

一方、こちら側の実装はこうなっていました。

```ts
// app/login/verify/route.ts
// メール本文のリンク先。GET されただけで検証エンドポイントへ送られる
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");

  return Response.redirect(
    `https://api.example.com/api/auth/magic-link/verify?token=${token}`
  );
}
```

JavaScript の実行も、利用者の操作も必要ありません。
GET された時点で検証が走り、トークンが消費されます。

この 2 つが噛み合うと、次の流れになります。

![解析ボットが利用者より先にマジックリンクを踏む流れ](https://pub-a61206ae19934ac48bdb67c6c59ee370.r2.dev/92699e1dfa590b2fea3d102e4d0b4da3.png)

なお、この解析がメールの受信時に行われるのか、利用者がリンクを押した時に行われるのかは特定できませんでした。
公式ドキュメントに記載があるのは受信時のクロールです。
どちらであっても、GET でトークンが消費されるという事実は変わりません。

## ログではこう見える

ここからは、実際に自分のログで判定するための手順です。
アプリケーションログとロードバランサーのアクセスログを、この順に見ます。

### API ログ：verify が 2 回叩かれている

まずアプリケーションログを見ます。
1 つのマジックリンクに対して、検証エンドポイントが 2 回叩かれていました。

```
10:00:00  POST /api/login-magic-link        200 (254ms)   メール送信
10:00:15  GET  /api/auth/magic-link/verify  302 ( 18ms)   1 回目
10:00:22  GET  /api/auth/magic-link/verify  302 (  5ms)   2 回目
```

ここで注意が必要なのは、**ステータスコードでは成否を判別できない**ことです。
better-auth の検証エンドポイントは、成功時は `callbackURL` へ、失敗時は `errorCallbackURL` へリダイレクトします。
どちらも 302 を返します。

代わりに処理時間を見ます。
1 回目の 18ms はセッションの発行を伴う重さ、2 回目の 5ms はトークンが見つからず即座にエラーを返す軽さです。

ただし、この時点では「誰が叩いたのか」までは分かりません。

### ALB ログ：同一トークンに 2 人いた

次にロードバランサーのアクセスログを見ます。
ここが決定打でした。

同一のトークンに対して、**User-Agent の異なる 2 者**がアクセスしていました。
User-Agent はブラウザが自分の名前とバージョン、OS を名乗る文字列です。
これが違うということは、別の環境から叩かれているということです。

```
10:00:14.8  [Linux Chrome/1xx]    GET /login/verify?token=aB3xY9dQ...
10:00:15.0  [Linux Chrome/1xx]    GET /api/auth/magic-link/verify
10:00:15.3  [Linux Chrome/1xx]    GET /auth/verification
10:00:15〜17 [Linux Chrome/1xx]   CSS / JS チャンク / woff2 を大量に取得

10:00:22.0  [Windows Edg/1xx]     GET /login/verify?token=aB3xY9dQ...
10:00:22.1  [Windows Edg/1xx]     GET /api/auth/magic-link/verify
10:00:22.3  [Windows Edg/1xx]     GET /login/invalid
```

利用者本人が使っているのは Edge です（`Edg/1xx`）。
先にトークンを消費したのは、`Edg` を含まない Linux の Chrome でした。

この Chrome が解析ボットだと判断できる根拠は 2 つあります。

- 利用者が使っていないブラウザ・OS の組み合わせであること
- CSS・JS チャンク・フォントまで取得していること。つまり **JavaScript を実行するヘッドレスブラウザ**であること

ログを追うときに知っておくとよい点が 2 つあります。

1 つは、送信元 IP が追えないことです。
CDN を経由している場合、ログに残る送信元 IP はすべて CDN のものになります。

もう 1 つは、**User-Agent に製品名が一切含まれない**ことです。
「Cisco」や「scanner」といった文字列で検索しても何も出てきません。
判別できるのは、利用者と異なる User-Agent が同じトークンを叩いているという事実だけです。

そのため、利用者と解析ボットがたまたま同じブラウザ・同じバージョンだった場合、アクセスログだけでは 2 者を区別できません。
送信元 IP も CDN のものに潰れているので、そちらでも切れません。
その場合でも「自分以外の誰かがトークンを先に消費した」ことまでは分かりますが、それが何なのかはログの外で確かめることになります。

一方、同じトークンへのアクセスがそもそも 1 回しか無い場合は、別の原因を疑ったほうがよいです。
Zenn の記事「[マジックリンク認証の落とし穴](https://zenn.dev/chorkaichan/articles/78b89eab08f55d)」では、iOS でリンクを長押ししたときのプレビュー表示によって認証処理が走る例が挙げられています。
症状はほぼ同じですが、原因も対処も変わります。

## 再現しないのはレース条件だから

この事象は、同じ操作でも成功したり失敗したりします。
解析ボットと利用者のどちらが先に検証エンドポイントへ到達するかで結果が決まるためです。

実際に、2 回の試行で順序が逆転していました。
メール送信からの経過秒数で並べると、こうなります。

| 試行 | ボット | 利用者 | 先着 | 結果 |
|---|---|---|---|---|
| 1 回目 | +14 秒 | +22 秒 | ボット | 失敗 |
| 2 回目 | +32 秒 | +14 秒 | 利用者 | 成功 |

利用者側は 22 秒から 14 秒に短縮しています。
1 回目はメールの着信に気づくまで時間がかかり、2 回目は再送を待ち構えてすぐ押した、という自然な差です。

ボット側は 14 秒から 32 秒に遅れています。
解析キューの混み具合によるもので、こちらから制御する手段はありません。

この 2 つが重なって 18 秒の差がつき、順序が入れ替わりました。

2 回目のアクセスログがこちらです。
先ほどとは役割が入れ替わっています。

```
10:02:32.8  [Windows Edg/1xx]     GET /login/verify?token=Kp7vR2mN...
10:02:32.9  [Windows Edg/1xx]     GET /api/auth/magic-link/verify
10:02:33.0  [Windows Edg/1xx]     GET /auth/verification
                                  ← 利用者はログインできている

10:02:50.6  [Linux Chrome/1xx]    GET /login/verify?token=Kp7vR2mN...
10:02:50.8  [Linux Chrome/1xx]    GET /api/auth/magic-link/verify
10:02:51.0  [Linux Chrome/1xx]    GET /login/invalid
                                  ← 今度はボットがエラー画面を踏んでいる
```

1 回目に利用者が見たエラー画面を、2 回目はボットが見ています。

ここで重要なのは、**2 回目の成功は不具合が直ったわけではない**ということです。
利用者が先に到達しただけです。
「再送したら入れました」という報告は、直った証拠にはなりません。

そして、この逆転が原因の特定に役立ちます。
役割が入れ替わっても結果が到達順に従っているため、順序以外の要因をすべて否定できます。
トークンの有効期限、認証ライブラリの不具合、特定ブラウザ固有の問題は、いずれも 2 回目の成功を説明できません。

## 見落としがちなもう一つの影響

ここまでは「ログインできない」という話でした。
ただし、影響はそれだけではありません。

検証に成功した側は、**セッションを受け取ります**。
解析ボットが JavaScript を実行するなら、そのままリダイレクトを辿ってログイン後の画面まで到達しえます。

つまり、ログインできないという不便とは別に、**認証済みのセッションがスキャン環境に渡る経路が存在する**ことになります。

これは対策の優先度に関わります。
「再送すれば入れるのだから優先度は低い」と判断してしまいがちですが、セッションが外に出る経路が残っている、という見方をすると評価は変わります。


## 対策の選択肢

| 案   | 内容                  | 効果                    |
| --- | ------------------- | --------------------- |
| A   | 検証を POST 起点にする      | 解析ボットの GET では何も起きなくなる |
| B   | リンクではなくコードを送る       | クリックされる対象がなくなる        |
| C   | 利用者側でスキャン対象から外してもらう | 相手の設定に依存する。別の製品では再発する |

### 案 A：検証を POST 起点にする

メールのリンク先を、**ボタンを表示するだけのページ**に変更します。
トークンの検証は、ボタンが押されたとき（POST もしくは利用者の操作を起点とした通信）に行います。

```tsx
// app/login/verify/page.tsx
// リンクを開いた時点では検証せず、ボタンを表示するだけにする
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <form action="/api/login/verify" method="post">
      <input type="hidden" name="token" value={token} />
      <button type="submit">ログインを完了する</button>
    </form>
  );
}
```

解析ボットは GET しか行いません。
そのため、そもそもレースが発生しなくなります。

これは推測ではなく、ログから確認できました。
先ほどの 2 回目のログで、エラー画面を踏んだボットはそこからログイン画面へリンクを辿っています。
一方で、**フォームの送信やボタンの押下はしていませんでした**。

引き換えに、ログインのクリックが 1 回増えます。

:::note warn
この確認ページに「読み込み時にフォームを自動送信する JavaScript」を入れてはいけません。
今回のボットは JavaScript を実行するヘッドレスブラウザだったので、その送信をそのまま完了させます。
ボタンを置いた意味がなくなります。
:::

なお、この「確認ページを挟む」対応を magic-link プラグインの組み込み機能として用意してほしい、という要望が better-auth にも出ています（2026 年 9 月時点でオープン）。
同じ結論に至っている人は少なくないようです。

### 案 B：リンクではなくコードを送る（メール OTP）

メールにリンクを載せるのをやめ、数字のコードを書いて画面で入力してもらう方式です。
メール OTP、ワンタイムパスワードと呼ばれます。

クリックする対象が存在しないので、解析ボットがメールを処理しても何も起きません。
案 A が「GET されても消費しない」ようにするのに対し、こちらは「GET される URL 自体を無くす」対応です。

better-auth を使っているなら、`emailOTP` プラグインが標準で用意されています。
マジックリンクを差し替える形で導入できます。

```ts
import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";

export const auth = betterAuth({
  plugins: [
    emailOTP({
      async sendVerificationOTP({ email, otp, type }) {
        await sendMail(email, `認証コード: ${otp}`);
      },
    }),
  ],
});
```

`type` には `sign-in` / `email-verification` / `forget-password` / `change-email` が渡ります。
ログインだけでなく、パスワードリセットやメールアドレス変更も同じ方式でまかなえます。
先ほど「同じ穴がある」として挙げた機能を、まとめて塞げるということです。

引き換えに、メールを開いてコードを読み、アプリに戻って入力する手間が増えます。

ここで注意したいのは、**コードにしてもセキュリティが上がるわけではない**ことです。
米国 NIST の認証ガイドライン SP 800-63B は、メールを認証チャネルとして使うこと自体を禁じています（SHALL NOT）。
リンクかコードかという配信形式は区別されていません。
あくまで「スキャナに先を越されなくなる」対策として選ぶものです。

### 案 C：スキャン対象から外してもらう

利用者側の IT 部門に、メール内のリンク先ドメインを URL 書き換えの対象から除外してもらう方法です。

こちら側の実装変更は不要ですが、制約が 3 つあります。

1. 相手の設定に依存する。別の利用者が Proofpoint や Mimecast、Defender for Office 365 を使っていれば、同じ事象がまた起こる
2. 除外しても完全には止まらない製品がある。Microsoft は「Do not rewrite the following URLs」に登録しても、クリック時のブロック判定は別に働きうると案内している
3. 除外した範囲のリンクが検査されなくなる。自分のドメインがフィッシングに悪用された場合の保護も同時に落ちる

なお、除外の指定単位は製品によって違います（Cisco と Microsoft はリンク先、Proofpoint と Mimecast は送信者を基準にした除外も持っています）。

### そのほか：トークンを URL のフラグメントに置く

`#` 以降のフラグメントはサーバーへ送信されないため、スキャナがリンクを GET してもトークンが渡りません。
クリックが増えないので、案 A の欠点を回避できます。

その代わり、フラグメントを読んで検証へ渡す JavaScript が必須になります。
Supabase の Discussion で提案されている方式で、公式のベストプラクティスとして確立しているものではありません。

### 注意：トークンを複数回使えるようにしてはいけない

もっとも手軽に見える回避策は「トークンを 1 回使い切りにしない」ことです。
これは採用できません。

better-auth では、まさにこの事象を理由に `allowedAttempts` というオプションが追加されました。
ところがその後、検証処理そのものに競合状態があることが判明します。
トークンの照会・無効化・セッション発行が別々のデータベース操作だったため、**同時に届いた 2 つのリクエストの両方が有効なセッションを受け取れる**状態でした。

修正 PR の説明では、この状況が起こる経路としてメールサーバーのプリフェッチやリンクスキャナが挙げられています。
今回の事象そのものが、攻撃者のセッションを利用者の隣に発生させる経路になりえた、ということです。

現在の better-auth では、トークンは最初の検証で原子的に消費されます。
`allowedAttempts` は非推奨になり、1 以外の値を指定しても無視されて警告が出るだけになりました。

```
Allowed attempts for verifying the magic link token.

@deprecated Multi-attempt verification is no longer supported. Each
magic link token is consumed atomically on the first verification call,
so a given token mints at most one session regardless of this value
```

（better-auth 1.6.30 の型定義より引用）

トークンを使い回せるようにすることは、ログインできない問題を、セッションを奪える問題に置き換える行為です。
この方向は塞がっていると考えたほうがよいです。

## 最後に

原因が分かってみれば、GET に認証トークンの消費という副作用を持たせていたことが問題でした。
そこへメールセキュリティ製品のスキャナが先に到達しただけです。

自分たちのコードに問題がなくても、メールセキュリティ製品のような外部の仕組みによって壊れることがあります。
そのため、認証のようなサービスの中でも重要度の高い部分に関しては、設計段階で外部の影響を意識できると良いなと思いました。

マジックリンクを実装しているなら、メールのリンクが GET されただけでトークンを消費していないか、一度確認してみてください。
もし、上記対策の問題や、他に推奨される方法を知っている人は、コメントで教えていただけると幸いです。🙇‍♂️

## 参考文献

- メールセキュリティ製品の公式ドキュメント
    - [URL Rewriting and Analysis (using Outbreak Filters) - Cisco](https://docs.ces.cisco.com/docs/url-rewriting-and-analysis)
    - [Outbreak Filters - Cisco Secure Email Gateway AsyncOS 15.0 User Guide](https://www.cisco.com/c/en/us/td/docs/security/esa/esa15-0/user_guide/b_ESA_Admin_Guide_15-0/b_ESA_Admin_Guide_12_1_chapter_01111.html)
    - [Set up Safe Links policies in Microsoft Defender for Office 365](https://learn.microsoft.com/en-us/defender-office-365/safe-links-policies-configure)
- better-auth での議論
    - [Magic Link token consumed by email security scanners/preview bots before user clicks - Discussion #6985](https://github.com/better-auth/better-auth/discussions/6985)
    - [Magic Link - Option to allow multiple attempts - Issue #5550](https://github.com/better-auth/better-auth/issues/5550)
    - [fix(magic-link): consume verification token atomically on verify - PR #9572](https://github.com/better-auth/better-auth/pull/9572)
    - [Magic-link plugin: built-in support for consent-page step to defeat corporate email URL scanners - Issue #9690](https://github.com/better-auth/better-auth/issues/9690)
- ほかのサービスでの同様の報告
    - [Magic links and password reset tokens consumed by email scanners in institutional environments - Supabase Discussion #41618](https://github.com/orgs/supabase/discussions/41618)
    - [Microsoft Defender Office 365 Safe Links Policy - onetimesecret Issue #359](https://github.com/onetimesecret/onetimesecret/issues/359)
    - [Add a configuration option to avoid consumption of magic links from security products - magiclinksdev Issue #2](https://github.com/MicahParks/magiclinksdev/issues/2)
    - [マジックリンク認証の落とし穴 - Zenn](https://zenn.dev/chorkaichan/articles/78b89eab08f55d)（原因は iOS のリンクプレビュー）
- 対策の参考
    - [Magic Link - WorkOS Docs](https://workos.com/docs/magic-link)（リンク方式を非推奨とし、コード方式を推奨）
    - [Authentication With Magic Links & One-Time Passwords - FusionAuth Docs](https://fusionauth.io/docs/lifecycle/authenticate-users/passwordless/magic-links)
    - [NIST SP 800-63B: Authenticator and Verifier Requirements](https://pages.nist.gov/800-63-4/sp800-63b.html)（3.1.3 Out-of-Band Devices）

## 株式会社シンシア

株式会社シンシアでは、実務未経験のエンジニアの方や学生エンジニアインターンを採用し一緒に働いています。
※ シンシアにおける働き方の様子はこちら

https://www.wantedly.com/companies/xincere-inc/stories

弊社には年間100人以上の実務未経験の方に応募いただき、技術面接を実施しております。
この記事が少しでも学びになったという方は、ぜひ wantedly のストーリーもご覧いただけるととても嬉しいです！
