CRX Lab - CRX-20iA/L 3Dシミュレーター
========================================

■ 必要なもの
  Windows 10/11
  Node.js 22以降（https://nodejs.org/）
  初回セットアップ時のみインターネット接続

■ 起動方法
  1. ZIPを任意の場所へ展開します。
  2. run-local.bat をダブルクリックします。
  3. 初回のみ必要な部品が自動インストールされます。
  4. ブラウザで http://localhost:3000/ が開きます。

■ 終了方法
  起動時に開いた黒い画面で Ctrl+C を押し、Yを入力します。

■ 注意
  index.htmlを直接ダブルクリックする方式ではありません。
  3Dモデルファイルを安全に読み込むため、PC内だけで動く
  ローカルWebサーバーを使用します。外部への公開は行いません。

■ モデルデータ
  FANUC-CORPORATION/fanuc_description のCRX-20iA/L visual meshを使用。
  詳細は public/models/crx20ia_l/ATTRIBUTION.txt を参照してください。
