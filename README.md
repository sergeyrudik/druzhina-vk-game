# Дружина — защита города

Казуальная merge-стратегия для VK Mini Apps. Игрок собирает дружину,
объединяет одинаковых бойцов, защищает город от волн противников и получает
награды за прогресс.

- VK Mini App: [app54694176](https://vk.com/app54694176)
- production: [sergeyrudik-druzhina-vk-game-3412.twc1.net](https://sergeyrudik-druzhina-vk-game-3412.twc1.net/)
- репозиторий: [sergeyrudik/druzhina-vk-game](https://github.com/sergeyrudik/druzhina-vk-game)
- политика конфиденциальности: [production/privacy/](https://sergeyrudik-druzhina-vk-game-3412.twc1.net/privacy/)
- пользовательское соглашение: [production/terms/](https://sergeyrudik-druzhina-vk-game-3412.twc1.net/terms/)

## Стек

- Next.js 16 и React 19;
- TypeScript;
- VK Bridge;
- статический экспорт Next.js в `out/`;
- Timeweb Cloud App Platform.

Игра не требует собственного backend для базового сценария. Прогресс хранится
локально и в VK Storage. Реклама и данные профиля доступны только при запуске
внутри VK.

## Локальный запуск

Требуется Node.js `>=22.13.0` и pnpm.

```bash
pnpm install
pnpm run dev
```

Откройте адрес из терминала. В обычном браузере VK Bridge может быть недоступен —
это ожидаемо; игровой сценарий должен продолжать работать с локальным
сохранением.

Полезные команды:

```bash
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run test:all
pnpm run timeweb:build
```

Production-сборка с `output: "export"` создаётся в каталоге `out/`. Проверить её
локально можно встроенным статическим сервером:

```bash
pnpm start
```

## Структура

```text
app/
  page.tsx          основной игровой экран и интеграция VK Bridge
  privacy/page.tsx  политика конфиденциальности
  terms/page.tsx    пользовательское соглашение
  globals.css       оформление игры и юридических страниц
docs/
  PRODUCT_METRICS.md
  RELEASE_CHECKLIST.md
public/             статические ресурсы
tests/              автоматические тесты
```

## Настройка Timeweb Cloud

Для приложения из GitHub используются следующие параметры:

| Поле | Значение |
| --- | --- |
| Репозиторий | `sergeyrudik/druzhina-vk-game` |
| Ветка | `main` |
| Окружение | Node.js 22 |
| Корень проекта | `/` |
| Команда сборки | `pnpm run timeweb:build` |
| Директория сборки | `out` |
| Автодеплой | включён для `main` |

Секретный ключ приложения VK, access token разработчика и токены Timeweb нельзя
добавлять в клиентский код, `.env`, историю Git или настройки сборки
статического приложения. Для текущей версии они не нужны.

После успешного деплоя в настройках VK Mini Apps укажите один и тот же HTTPS URL
для Web, мобильной версии сайта и мобильного приложения:

```text
https://sergeyrudik-druzhina-vk-game-3412.twc1.net/
```

Сначала URL проверяется в режиме разработки и тестовой группе. Перед
модерацией нужно отключить режим разработки и повторить проверку из обычного
аккаунта.

## Интеграция VK

При запуске приложение инициализирует VK Bridge и использует:

- `VKWebAppGetUserInfo` — имя и аватар в интерфейсе;
- `VKWebAppStorageGet` / `VKWebAppStorageSet` — облачное сохранение;
- `VKWebAppCheckNativeAds` / `VKWebAppShowNativeAds` — rewarded и interstitial;
- `VKWebAppTrackEvent` — продуктовые события, если аналитика включена.

Любая функция VK должна иметь безопасный fallback: отказ Bridge, отсутствие
рекламы или запуск вне VK не должны блокировать игру.

## Подготовка релиза

Полный список находится в
[docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md). Минимальный релизный
барьер:

1. `pnpm run typecheck`, `pnpm run lint`, `pnpm run test:all` и
   `pnpm run timeweb:build` проходят.
2. Проверены новая игра, продолжение, победа, поражение и восстановление
   сохранения.
3. Rewarded-реклама начисляет награду только после успешного результата.
4. Игра протестирована в VK без VPN на компьютере, Android и iPhone.
5. В кабинете VK заполнены описание, возрастной рейтинг, изображения,
   контакты, политика и соглашение.
6. Production URL и юридические страницы отвечают по HTTPS.

Воронка, целевые метрики, рекламная модель и первые A/B-тесты описаны в
[docs/PRODUCT_METRICS.md](docs/PRODUCT_METRICS.md).

Готовые тексты, иконки, сниппет, скриншоты и инструкция по заполнению карточки
VK находятся в [moderation/README.md](moderation/README.md). Проверить размеры
файлов можно командой `pnpm run moderation:validate`.

## Работа с релизами

- изменения вносятся отдельной веткой;
- pull request должен пройти CI и ручной smoke-test;
- production-деплой выполняется из `main`;
- после деплоя проверяются VK iframe, реклама, сохранение и консоль браузера;
- версия и заметки о релизе фиксируются в GitHub.

Не публикуйте новый игровой баланс и новую рекламную механику одновременно без
отдельных аналитических событий: иначе невозможно понять причину изменения
удержания или дохода.
