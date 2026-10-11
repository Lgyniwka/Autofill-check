// =====================================================
//  Справочник формы заказа запчастей
//  Яндеkс.Форма 13693051
//  «Интегрированная форма - Запрос на выдачу зап.частей (сервис)»
//  https://forms.yandex-team.ru/ext/surveys/13693051/
//
//  Создаёт тикет в очереди SDCWH при отправке.
//  Используется для автозаполнения через submit_form / get_form_suggest.
// =====================================================
const SPARE_PARTS_FORM = {
    formId: 13693051,
    name: 'Интегрированная форма - Запрос на выдачу зап.частей (сервис)',
    url: 'https://forms.yandex-team.ru/ext/surveys/13693051/',

    // ---------- Обязательные поля ----------
    fields: {
        location: 'answer_wiki_9008987764243672',            // Локация (suggest)
        robotStatus: 'answer_one_answer_9008988226731508',   // Статус робота (radio)
        isSC: 'answer_one_answer_9008988226019256',          // Это СК? (radio)
        materialType: 'answer_choices_1908101',              // Тип ТМЦ (radio)
        productSeries: 'answer_wiki_9008976633551088',       // Серия компонент (suggest, multichoice)
        operator: 'answer_choices_2269452',                  // Оператор услуг (SIM) (onerow)
        partComment: 'answer_long_text_9008956143171022',    // Какая запчасть требуется? (текст)
        component: 'answer_wiki_9008976630414950',           // Компонента (suggest, parent, hidden)
        photo: 'answer_files_1655492'                        // Фотография (file, hidden/условный)
    },

    // ---------- Значения enum-полей ----------
    enumValues: {
        robotStatus: { donor: '9008988226731518', notDonor: '1788972002689' },
        isSC: { yes: '9008988226019266', no: '1788971284642' },
        materialType: { parts: '3179563', sim: '3179568' },
        operator: { MTS: '3822749', Beeline: '3822750', Megafon: '3822751' }
    },

    // ---------- Скрытые служебные поля (из родительского тикета) ----------
    hiddenFields: {
        model: 'model',                 // Модель объекта
        priority: 'priority',           // Приоритет
        rover: 'rover',                 // Имя ровера
        issueKey: 'issue_key',          // Номер родительского тикета
        issueComponent: 'issue_component', // Компонента (не актуально)
        modelObject: 'model_objeckt',   // Модель (robot_r3 / robot_r2)
        eventId: 'event_Id',            // eventId для связи подзадач
        homePort: 'homePort',           // Порт приписки
        product: 'answer_choices_9008955456488524' // Выберите продукт (hidden radio) → Робот 9008955456488534
    },

    // ---------- Локации (suggest id) ----------
    locations: {
        'Рободоставка Арма': '1258532',                                 // 1
        'Рободоставка Шарапово': '1258533',                             // 2
        'Рободоставка Мытищи': '1258534',                               // 3
        'Рободоставка Мурино': '1258535',                               // 4
        'Рободоставка Иннополис': '1258536',                            // 5
        'ТП Роко-лаб СПБ-1': '1258537',                                 // 6
        'СПБ ЮГ | ТП КР Транспорт СПБ-1': '1258538',                    // 7
        'Казань | ТП Аргамак КЗН-1': '1258539',                         // 8
        'Нижний Новгород | ТП Аргамак НН-1': '1258540',                 // 9
        'МСК Север | ТП Север ИП Лупета МСК-1': '1258541',              // 10
        'МСК Юг | ТП ЮГ (Люберцы) Континент МСК-1': '1258542',          // 11
        'ТП Некст МСК-1': '1258543',                                    // 12
        'МСК Запад | ТП Запад Роботехнологии МСК-1': '1258544',         // 13
        'Воронеж | ТП МК Авто ( Воронеж)': '1258545',                   // 14
        'Тюмень': '1258671'                                             // 15
    },

    // ---------- Серии компонент (suggest id + ряд вопросов) ----------
    // id — значение для productSeries
    // seriesId — id ряда вопросов (Вики + Количество)
    // qtyId — id вопроса «Количество» внутри ряда
    series: {
        'ROBOT_BODY_FLAG':        { id: '1143758', groupId: 'id-question-55447748', qtyId: 'id-question-55447747' },
        'ROBOT_SUSPENSION_WHEEL': { id: '1143759', groupId: 'id-question-55449049', qtyId: 'id-question-55449048' },
        'ROBOT_BODY_BAG':         { id: '1143760', groupId: 'id-question-55449040', qtyId: 'id-question-55449039' },
        'ROBOT_COOLING':          { id: '1143761', groupId: 'id-question-55449034', qtyId: 'id-question-55449036' },
        'ROBOT_BODY_DAMAGE':      { id: '1143762', groupId: 'id-question-55449029', qtyId: 'id-question-55449030' },
        'ROBOT_BODY_COVER':       { id: '1143763', groupId: 'id-question-55447324', qtyId: 'id-question-55447325' },
        'ROBOT_SENSORS_LIDAR':    { id: '1143764', groupId: 'id-question-55447339', qtyId: 'id-question-55447340' },
        'ROBOT_SPEAKER':          { id: '1143765', groupId: 'id-question-55447351', qtyId: 'id-question-55447352' },
        'ROBOT_BOARDS_MOTORCONTROL': { id: '1143766', groupId: 'id-question-55447369', qtyId: 'id-question-55447371' },
        'ROBOT_SUSPENSION':       { id: '1143767', groupId: 'id-question-55447376', qtyId: 'id-question-55447377' },
        'ROBOT_SENSORS_RADAR':    { id: '1143768', groupId: 'id-question-55447383', qtyId: 'id-question-55447381' },
        'ROBOT_BOARDS_PCU':       { id: '1143769', groupId: 'id-question-55447394', qtyId: 'id-question-55447392' },
        'ROBOT_COMP_MODEM':       { id: '1143770', groupId: 'id-question-55447593', qtyId: 'id-question-55447592' },
        'ROBOT_SENSORS_LIDAR_WIRE': { id: '1143771', groupId: 'id-question-55447632', qtyId: 'id-question-55447631' },
        'ROBOT_SENSORS_CAMERA_WIRE': { id: '1143772', groupId: 'id-question-55447644', qtyId: 'id-question-55447643' },
        'ROBOT_SENSORS_CAMERA':   { id: '1143773', groupId: 'id-question-55447648', qtyId: 'id-question-55447647' },
        'ROBOT_SENSORS_ULTRASONIC': { id: '1143774', groupId: 'id-question-55447686', qtyId: 'id-question-55447685' },
        'ROBOT_SUSPENSION_TIRE':  { id: '1143775', groupId: 'id-question-55447689', qtyId: 'id-question-55447688' },
        'ROBOT_BODY_SKIN':        { id: '1143776', groupId: 'id-question-55447719', qtyId: 'id-question-55447718' },
        'ROBOT_COMP_NETWORK':     { id: '1143777', groupId: 'id-question-55447723', qtyId: 'id-question-55447722' },
        'ROBOT_BOARDS_RBCM':      { id: '1143778', groupId: 'id-question-55447730', qtyId: 'id-question-55447729' },
        'ROBOT_LIGHTING':         { id: '1143779', groupId: 'id-question-55447739', qtyId: 'id-question-55447738' },
        'ROBOT_ELECTRIC_WIRING':  { id: '1143780', groupId: 'id-question-55449059', qtyId: 'id-question-55449058' },
        'ROBOT_BATTERY':          { id: '1202679', groupId: 'id-question-55447752', qtyId: 'id-question-55447751' },
        'ROBOT_COMP':             { id: '1266601', groupId: 'answer_series_9008988297581504', qtyId: 'answer_integer_9008988297869924' }
    }
};