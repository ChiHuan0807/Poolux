import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Navbar } from '@/components/Navbar'

export function Terms() {
  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-primary)' }}>
      <Navbar />
      <main className="max-w-2xl mx-auto px-6 pt-24 pb-32">
        <Link to="/" className="inline-flex items-center gap-2 mb-8 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <ArrowLeft className="w-4 h-4" />
          返回首页
        </Link>

        <h1 className="text-2xl font-semibold mb-8" style={{ color: 'var(--text-primary)' }}>用户协议</h1>

        <div className="space-y-6 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          <p>购买、使用我们的资源，即表明你已阅读并同意本协议。</p>

          <section>
            <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>一、协议的范围</h2>
            <div className="space-y-3">
              <p>本协议是您与本资源开发者之间使用米坛社区付费支付系统所购买与使用本资源所订立的协议。"本资源开发者"指您购买的资源的著作权权利人，在本协议中更多地称为"开发者"。</p>
              <p>如果您未满 16 周岁，你无权使用购买本资源。</p>
            </div>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>二、资源的提供与使用</h2>
            <div className="space-y-3">
              <p>您承认本资源并非为满足您的个性化要求而开发，因此您有责任在购买前确保产品的各项功能符合您的需求。</p>
              <p>您理解并同意，本资源的各项功能是按照现有技术和条件所能达到的现状提供的。开发者会尽最大努力向您提供服务，确保服务的连贯性和安全性；但开发者不能随时预见和防范法律、技术以及其他风险，包括但不限于不可抗力、病毒、木马、黑客攻击、系统不稳定、服务瑕疵、政府行为等原因可能导致的服务中断、数据丢失以及其他的损失和风险。</p>
              <p>您理解并同意，本资源并非为某些特定目的而设计，包括但不限于核设施、军事用途、医疗设施、交通通讯等重要领域。如果因为本资源的原因导致上述操作失败而带来的人员伤亡、财产损失和环境破坏等，开发者不承担法律责任。</p>
              <p>您承诺遵守所有适用的经济与贸易制裁以及出口管制法律法规，包括所有由联合国安全理事会、中华人民共和国、美利坚合众国及任何其他国家所制定并执行的制裁决议、法律与法规以及出口管制法律与法规。您承诺不会将本资源用于适用出口管制法律所禁止的用途。非经相关主管机关许可，您及您授权使用本资源的个人或实体不会通过本资源向所适用出口管制法律所制裁或指定的个人或实体提供受控的技术、软件或服务，或以任何方式使得本资源开发者违反适用出口管制法律。</p>
              <p>您依本协议条款所取得的权利不可转让。</p>
            </div>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>三、著作权</h2>
            <div className="space-y-3">
              <p>每个许可证将给予您本人一项个人的、不可转让及非排他性的许可。此许可可以用于您个人拥有的任何设备。</p>
              <p>除非开发者本人的书面许可，您不得从事下列任一行为：</p>
              <p>（1）删除资源及其副本上关于著作权的信息；</p>
              <p>（2）对本资源的任何组成部分出租、出借、复制、修改、链接、转载、汇编、发表、出版、建立镜像等；</p>
            </div>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>四、收费政策</h2>
            <p>开发者可能根据实际需要对各项内容的收费标准、方式进行修改和变更，开发者也可能会对部分免费服务开始收费。</p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>五、第三方提供的产品或服务</h2>
            <p>您在使用本资源时可能需要使用其他第三方提供的产品或服务时，除遵守本协议约定外，还应遵守第三方的用户协议。</p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>六、退款政策</h2>
            <div className="space-y-3">
              <p>本资源属于数字产品，出售后不接受退款。</p>
              <p>若有关于产品的问题，请加入QQ群 498544791、273793080 进行反馈。</p>
            </div>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>七、违法违规行为</h2>
            <div className="space-y-3">
              <p>您在使用本资源时须遵守您的所在地、运行的服务器所在地、中华人民共和国以及美利坚合众国的法律法规，不得利用本资源从事或者帮助从事违法违规行为，包括但不限于：</p>
              <p>（1）发布、传送、传播危害中华人民共和国安全统一、破坏社会稳定、有损中华民族精神、伤害中华民族感情、违反公序良俗、侮辱、诽谤、淫秽、暴力以及任何违反国家法律法规的内容；</p>
              <p>（2）发布、传送、传播侵害他人知识产权、商业秘密等合法权利的内容；</p>
              <p>（3）发布、传送、传播恶意虚构事实、隐瞒真相以误导、欺骗他人的内容；</p>
              <p>（4）发布、传送、传播任何含有人身侮辱性质内容、令人不安的内容、宗教斗争色彩、政治色彩、精神污染内容；</p>
              <p>（5）发布、传送、传播任何纵容、美化战争的内容；</p>
              <p>（6）发布、传送、传播任何对于任何个体身份（如种族、宗教、性别、取向、残疾）的攻击内容；</p>
              <p>（7）发布、传送、传播引战内容；</p>
              <p>（8）其他法律法规禁止的行为。</p>
              <p>如果开发者发现或收到他人举报您违反本约定，开发者有权进行独立判断。同时，开发者有权视您的行为性质，采取包括但不限于暂停或终止授权许可，追究法律责任等措施。</p>
            </div>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>八、条款标题</h2>
            <p>本协议所有条款的标题仅为阅读方便，本身并无实际涵义，不能作为本协议涵义解释的依据。</p>
          </section>

          <section>
            <h2 className="text-base font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>九、协议的生效与变更</h2>
            <div className="space-y-3">
              <p>您购买并使用本资源即视为您已阅读本协议并接受本协议的约束。</p>
              <p>开发者有权随时修改本协议条款。</p>
            </div>
          </section>
        </div>

        <div className="mt-12 pt-6 text-sm text-right" style={{ color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)' }}>
          <p>2026.6.14</p>
          <p className="mt-1">POOLUX Studio</p>
        </div>
      </main>
    </div>
  )
}